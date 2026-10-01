# Website

This website is built using [Docusaurus 3](https://docusaurus.io/), a modern static website generator. It is its own package (its own `pnpm-lock.yaml`), separate from the extension at the repository root.

### Installation

```
$ pnpm install
```

### Local Development

```
$ pnpm start
```

This command starts a local development server and opens up a browser window. Most changes are reflected live without having to restart the server. The dev server is served under the same base URL as production, `http://localhost:3000/tabverse/`.

### Build

```
$ pnpm build
```

This command generates static content into the `../../docs` directory (the GitHub Pages output of this repository) and can be served using any static contents hosting service.

### Deployment

```
$ GIT_USER=<Your GitHub username> USE_SSH=true pnpm deploy
```

If you are using GitHub pages for hosting, this command is a convenient way to build the website and push to the `gh-pages` branch.