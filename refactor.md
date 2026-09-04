I want to refactor this codebase

But first, I need to fully understand this codebase

Root:

- ./panel.html ie. AD Network tab -- HTML + css (theme)
- ./panel-pd.html ie. PD Network tab -- same
- ./options.html ie. Extension hostname settings screen -- same
- ./devtools.html ie. background page for something -- empty html only
- ./src/ -- main codebase
- ./.github/workflows/ -- CI/CD pipelines
- ./scripts/ -- Build scripts
- ./build/ and ./dist/ -- whats the difference?
- ./fonts/ -- fonts data

src:

- ./src/config/ -- constants, endpoints, namespaces, routes, storage-keys -- these are very well documented and used files -- This part is perfect
