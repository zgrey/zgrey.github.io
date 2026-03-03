# zgrey.github.io

Personal site built with [Eleventy](https://www.11ty.dev/) and deployed on GitHub Pages.

## Prerequisites

- [Node.js](https://nodejs.org/) (v20+)

## Setup

Install dependencies:

```
npm install
```

## Local Development

Start the dev server with live reload:

```
npm run dev
```

The site will be available at `http://localhost:8080/`. Press `Ctrl+C` to stop the server.

## Production Build

Generate the static site into the `_site/` directory:

```
npm run build
```

## Deployment

Pushing to `main` triggers a GitHub Actions workflow that builds and deploys the site to GitHub Pages automatically.

## Project Structure

```
src/
  _data/          Site-wide data (site.json)
  _includes/
    layouts/      Page templates (base, page, post)
    partials/     Reusable components (nav, footer)
  assets/
    css/          Stylesheets
    js/           Client-side scripts (animations)
  blog/           Blog posts (Markdown)
  code/           Code projects page
  research/       Research page
  index.njk       Landing page
```
