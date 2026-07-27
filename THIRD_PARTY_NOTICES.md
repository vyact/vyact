# Third-Party Software Notices

Vyact is open-source software licensed under the GNU Affero General Public License v3.0 (AGPL-3.0). It uses third-party open-source dependencies that remain subject to their respective licenses.

## Dependency inventories

The source repositories and exact resolved versions of application dependencies are recorded in:

- `app/requirements.txt` for Python dependencies
- `frontend/package.json` and `frontend/package-lock.json` for frontend dependencies
- `electron/package.json` and `electron/package-lock.json` for Electron packaging dependencies

When distributing a binary release, the project maintainer should preserve any third-party notices and license files required by the dependencies included in that release.

## Bundled third-party assets

This public source distribution may include assets that are identified in their original source or package metadata. Their original copyright notices and licenses apply.

### Pretendard

The frontend uses Pretendard, distributed under the SIL Open Font License, Version 1.1.

Source: <https://github.com/orioncactus/pretendard>

### Other dependencies

Other third-party components are installed from their official package registries during the build process. Refer to the dependency inventories above and to the licenses supplied by each dependency for their complete terms.

## No change to third-party licenses

Nothing in the Vyact license, documentation, or brand policy changes the terms that apply to third-party software. The Vyact name, logo, and official visual brand assets are governed separately by the [Vyact Brand and Trademark Policy](TRADEMARKS.md).
