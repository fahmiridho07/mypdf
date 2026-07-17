# Bundled Python runtime

This folder holds the embeddable Python runtime that ships inside the
installer, so end users need no Python of their own. It is populated by
`scripts/prepare-python.ps1` before a release build and is not committed
to git (only this note is).

Dev builds fall back to the system Python when this folder is empty.
