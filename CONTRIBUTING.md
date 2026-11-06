# Contributing to KaratWatch

Create a feature branch and open a pull request against the default branch.
Keep credentials in ignored `.env` files or Scriptable Keychain. Edit the public
`frontend/KaratWatch.js`, not the ignored personal widget.

Run `python -m compileall -q backend`, then from `backend` run
`python -m pytest tests -v`. Check the widget with
`node --input-type=module --check < frontend/KaratWatch.js`.
Run `python3 scripts/check_publication.py` after staging new files.

CI runs on every PR: Python 3.11/3.12 tests and compilation, widget syntax,
publication checks, Compose validation, and Docker build/startup.
It uses no production credentials and does not deploy. JavaScript syntax checks
do not emulate Scriptable or verify the UI on an iPhone.
