"""Enrich data/photos.json with attribution + best-available resolution.

    python3 -m pipeline.tools.photo_sources

For every photo:
  * Flickr  → oEmbed licence/author + the largest published size (6k…h, original)
  * Wikimedia Commons → licence, author, 3840px thumb (or original if smaller)
  * PxHere / Needpix / WordPress Photo Directory → CC0, PICRYL → Public Domain
Also applies REPLACE: low-resolution sources swapped for 3000–6000px Commons
originals of the same subject. Idempotent; writes photos.json in place.
"""
from __future__ import annotations

import collections
import concurrent.futures as cf
import json
import re

import requests

from ..agents.base import DATA

UA = {"User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/140 Safari/537.36"}
WM = {"User-Agent": "IndiaJourneysBuild/2.0 (https://github.com/sc8z35a-collab/India-Travel-spot-Opus5.5)"}
CC = {"CC BY 2.0": "https://creativecommons.org/licenses/by/2.0/", "CC BY 3.0": "https://creativecommons.org/licenses/by/3.0/",
      "CC BY 4.0": "https://creativecommons.org/licenses/by/4.0/", "CC BY-SA 2.0": "https://creativecommons.org/licenses/by-sa/2.0/",
      "CC BY-SA 3.0": "https://creativecommons.org/licenses/by-sa/3.0/", "CC BY-SA 4.0": "https://creativecommons.org/licenses/by-sa/4.0/",
      "CC BY-NC-ND 2.0": "https://creativecommons.org/licenses/by-nc-nd/2.0/", "CC BY-NC-SA 2.0": "https://creativecommons.org/licenses/by-nc-sa/2.0/",
      "CC0 1.0": "https://creativecommons.org/publicdomain/zero/1.0/", "Public Domain": "https://creativecommons.org/publicdomain/mark/1.0/"}
HOSTS = {"PxHere": "CC0 1.0", "Needpix": "CC0 1.0", "WordPress Photo Directory": "CC0 1.0", "PICRYL": "Public Domain",
         "PickPik": "PickPik Free License"}
# id → (Commons file, English title, Japanese alt)  — originals ≥ 3000 px replacing ≤ 1300 px sources
REPLACE = {
    "varanasi-birds": ("Oiseaux sur le Gange à Bénarès (1).jpg", "Gulls over the Ganges, Varanasi", "ガンジス川の小舟とカモメの群れ、背後にガート"),
    "kerala-houseboats": ("Houseboat on Alleppey backwaters (Kerala, India 2023) (52704577484).jpg", "Houseboats on the Alleppey backwaters", "ヤシ並木の水路に並ぶアレッピーのハウスボート"),
    "ladakh-nubra": ("Sand dunes and poplars Nubra Valley Ladakh.jpg", "Sand dunes and poplars, Nubra Valley", "ヌブラ谷の砂丘とポプラ並木、背後にカラコルムの山々"),
    "ladakh-khardung": ("Khardung La (pass), Ladakh Range, North India, Himalaya.jpg", "Khardung La, Ladakh Range", "カルドゥン・ラ峠から望むラダック山脈"),
    "kerala-munnar": ("Munnar Road and Tea Plantations (11223).jpg", "Tea plantations along the Munnar road", "青空の下、丘一面に広がるムンナールの茶畑"),
    "kerala-munnar2": ("Munnar - Lockhart tea plantation.jpg", "Lockhart tea plantation, Munnar", "なだらかな丘に続くムンナール・ロックハートの茶畑"),
    "kerala-thali": ("Kerala Onam Sadya.jpg", "Onam sadya on a banana leaf", "バナナの葉に盛られたケーララの祝い膳サディヤ"),
    "jaipur-hawa-street": ("Hawa Mahal east facade (14-07-2022).jpg", "Hawa Mahal, east facade", "青空に映えるハワー・マハルの正面と旧市街の通り"),
    "varanasi-sadhu": ("Varanasi, India, Ascetic in white turban 2.jpg", "Ascetic in a white turban, Varanasi", "白いターバンを巻いたバラナシの修行者"),
}


def commons(files: list[str]) -> dict:
    out = {}
    for i in range(0, len(files), 20):
        chunk = files[i:i + 20]
        r = requests.get("https://commons.wikimedia.org/w/api.php", headers=WM, timeout=40, params={
            "action": "query", "titles": "|".join("File:" + f for f in chunk), "prop": "imageinfo",
            "iiprop": "url|size|extmetadata", "iiurlwidth": 3840, "format": "json"}).json()
        back = {n["to"]: n["from"] for n in r["query"].get("normalized", [])}
        for p in r["query"]["pages"].values():
            ii = p["imageinfo"][0]; m = ii["extmetadata"]
            key = back.get(p["title"], p["title"])[5:].replace("_", " ")
            lic = m.get("LicenseShortName", {}).get("value", "")
            out[key] = {"hires": ii["thumburl"].split("?")[0] if ii["width"] > 3840 else ii["url"],
                        "link": ii["descriptionurl"], "license": lic, "license_url": CC.get(lic, m.get("LicenseUrl", {}).get("value", "")),
                        "author": re.sub(r"\s+", " ", re.sub("<[^>]+>", "", m.get("Artist", {}).get("value", ""))).strip()[:60],
                        "width": ii["width"]}
    return out


def flickr(link: str) -> dict:
    link = link.rstrip("/")
    o = requests.get("https://www.flickr.com/services/oembed/", params={"url": link, "format": "json"}, headers=UA, timeout=30).json()
    out = {"author": o.get("author_name", ""), "license": o.get("license", ""), "license_url": o.get("license_url") or CC.get(o.get("license"), "")}
    for s in ("6k", "5k", "4k", "3k", "k", "h", "o"):
        h = requests.get(f"{link}/sizes/{s}/", headers=UA, timeout=30).text
        m = re.findall(r'https://live\.staticflickr\.com/[^"\s]+_' + s + r'\.(?:jpg|png)', h)
        if m:
            out["hires"] = m[0]
            break
    return out


def main() -> None:
    path = DATA / "photos.json"
    D = json.loads(path.read_text(encoding="utf-8"), object_pairs_hook=collections.OrderedDict)
    photos = D["photos"]
    for p in photos:                                   # 1) swap weak sources for Commons originals
        if p["id"] in REPLACE:
            f, title, alt = REPLACE[p["id"]]
            p.update(source="Wikimedia Commons", link="https://commons.wikimedia.org/wiki/File:" + f.replace(" ", "_"),
                     title=title, alt=alt, _commons=f)
    wm_files = [p.get("_commons") or requests.utils.unquote(p["link"].split("File:")[1]).replace("_", " ")
                for p in photos if "wikimedia" in p["link"]]
    info = commons(wm_files)

    def one(p):
        if "flickr.com" in p["link"]:
            return p["id"], flickr(p["link"])
        if "wikimedia" in p["link"]:
            f = p.pop("_commons", None) or requests.utils.unquote(p["link"].split("File:")[1]).replace("_", " ")
            i = dict(info[f]); i.pop("width", None)
            if p["id"] in REPLACE:
                i["url"] = i["hires"]
            return p["id"], i
        lic = next(v for k, v in HOSTS.items() if p["source"].startswith(k))
        return p["id"], {"license": lic, "license_url": CC.get(lic, "https://www.pickpik.com/about")}

    with cf.ThreadPoolExecutor(6) as ex:
        res = dict(ex.map(one, photos))
    for p in photos:
        p.pop("_commons", None)
        p.update(res[p["id"]])
        print(f"{p['id']:22s} {p['license']:18s} {(p.get('author') or '')[:22]:22s} {'HIRES' if p.get('hires') else ''}")
    path.write_text(json.dumps(D, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()
