# FuzzyGraph

<https://schuhwerk.github.io/fuzzygraph/>

Graphs where equations are not only exactly true, but close to true: colour gradients instead of black lines.

- One self-contained HTML file; runs offline, no tracking
- The URL always holds the current graph (reload, bookmark, share)
- Saved PNGs embed the graph settings and can be reopened
- Cymatics, Mandelbrot and Julia generators (Equation → Functions)

## Development

```sh
npm install
npm run dev     # dev server
npm run build   # docs/
```

GitHub Pages serves the committed `docs/` folder (Settings → Pages → Source: Deploy from a branch, `main` / `/docs`). Run `npm run build` and commit `docs/` before pushing.

## Author

[Caleb Madrigal](https://github.com/calebmadrigal)
