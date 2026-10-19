# Carousel Spinner

A picture-based random picker built with React, TypeScript, and Vite.

## Requirements

- Git
- Node.js 22.12+ with npm
- A modern web browser

On Linux, install a compatible Node.js version using your preferred
version manager or distribution installation method.

Check your installed tools:

```bash
git --version
node --version
npm --version
```

## Setup on a New Device

Run these commands in a terminal, including on Linux:

```bash
git clone https://github.com/JoshuaTempla/carousel-spinner.git
cd carousel-spinner/picture-spinner
npm ci
npm run dev
```

Open the local address printed in the terminal.

Keep the terminal running while using the app.
Press Ctrl+C to stop the server.

> Run all npm commands inside `picture-spinner`, not the repository root.
> Do not run `npm create` again when setting up an existing project.

## How to Play

1. Click **Add pictures** and select at least two images.
2. Choose a spin duration.
3. Click **Spin to win**.
4. Use the fullscreen button for presenting.

Each uploaded file is one entry. Repeat winners are allowed.
Refreshing the page clears the uploaded pictures.

## Code Checks

From `picture-spinner`:

```bash
npm run lint
npm run build
```

## Get Updates

With your local changes committed or otherwise saved:

```bash
git pull --ff-only
npm ci
npm run dev
```

## Troubleshooting

### Dependency installation fails

Check your Node.js version first.

`npm ci` requires the committed `package.json` and `package-lock.json`
to agree. If they do not, fix and commit the dependency files on the
development device rather than deleting the lockfile.

### Blank page

Open the browser developer console and inspect the first error.

To restart Vite with a fresh dependency cache:

```bash
npm run dev -- --force
```

Do not copy `node_modules` from Windows to Linux.
Install dependencies on each device using `npm ci`.