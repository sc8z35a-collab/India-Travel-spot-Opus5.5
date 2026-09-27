"""Run one crew task in an isolated process (used for memory-heavy tasks so
their RAM is returned to the OS the moment they finish)."""
import sys


from .run import TASKS

if __name__ == "__main__":
    rep = TASKS[sys.argv[1]][1]().execute()
    sys.exit(0 if rep.ok else 1)
