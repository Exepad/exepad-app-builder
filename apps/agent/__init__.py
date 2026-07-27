# Agent API Package
import sys
import os

# Add the parent directory to sys.path to enable absolute imports
# This allows imports like 'from config import config' to work
_current_dir = os.path.dirname(os.path.abspath(__file__))
_parent_dir = os.path.dirname(_current_dir)
if _parent_dir not in sys.path:
    sys.path.insert(0, _parent_dir)

