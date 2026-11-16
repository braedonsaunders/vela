// The pixel-art icons (nine by nine), as path data painted in the current colour.
export const PIXEL: Record<string, string> = {
  alert:
    'M4 0h1v1h-1zM3 1h3v1h-3zM3 2h1v1h-1zM5 2h1v1h-1zM2 3h2v1h-2zM5 3h2v1h-2zM2 4h2v1h-2z' +
    'M5 4h2v1h-2zM1 5h7v1h-7zM1 6h3v1h-3zM5 6h3v1h-3zM0 7h9v1h-9z',
  back:
    'M5 0h2v1h-2zM4 1h3v1h-3zM3 2h3v1h-3zM2 3h3v1h-3zM1 4h3v1h-3zM2 5h3v1h-3zM3 6h3v1h-3z' +
    'M4 7h3v1h-3zM5 8h2v1h-2z',
  check:
    'M8 0h1v1h-1zM7 1h2v1h-2zM6 2h2v1h-2zM0 3h1v1h-1zM5 3h2v1h-2zM0 4h2v1h-2zM4 4h2v1h-2z' +
    'M1 5h4v1h-4zM2 6h2v1h-2z',
  close:
    'M0 0h2v1h-2zM7 0h2v1h-2zM0 1h3v1h-3zM6 1h3v1h-3zM1 2h3v1h-3zM5 2h3v1h-3zM2 3h5v1h-5z' +
    'M3 4h3v1h-3zM2 5h5v1h-5zM1 6h3v1h-3zM5 6h3v1h-3zM0 7h3v1h-3zM6 7h3v1h-3zM0 8h2v1h-2z' +
    'M7 8h2v1h-2z',
  ffwd:
    'M0 1h1v1h-1zM4 1h1v1h-1zM0 2h2v1h-2zM4 2h2v1h-2zM0 3h3v1h-3zM4 3h3v1h-3zM0 4h8v1h-8z' +
    'M0 5h3v1h-3zM4 5h3v1h-3zM0 6h2v1h-2zM4 6h2v1h-2zM0 7h1v1h-1zM4 7h1v1h-1z',
  forward:
    'M2 0h2v1h-2zM2 1h3v1h-3zM3 2h3v1h-3zM4 3h3v1h-3zM5 4h3v1h-3zM4 5h3v1h-3zM3 6h3v1h-3z' +
    'M2 7h3v1h-3zM2 8h2v1h-2z',
  full:
    'M0 0h3v1h-3zM6 0h3v1h-3zM0 1h1v1h-1zM8 1h1v1h-1zM0 2h1v1h-1zM8 2h1v1h-1zM0 6h1v1h-1z' +
    'M8 6h1v1h-1zM0 7h1v1h-1zM8 7h1v1h-1zM0 8h3v1h-3zM6 8h3v1h-3z',
  grid:
    'M1 0h3v1h-3zM5 0h3v1h-3zM1 1h3v1h-3zM5 1h3v1h-3zM1 2h3v1h-3zM5 2h3v1h-3zM1 4h3v1h-3z' +
    'M5 4h3v1h-3zM1 5h3v1h-3zM5 5h3v1h-3zM1 6h3v1h-3zM5 6h3v1h-3z',
  heart:
    'M1 1h2v1h-2zM6 1h2v1h-2zM0 2h4v1h-4zM5 2h4v1h-4zM0 3h9v1h-9zM0 4h9v1h-9zM1 5h7v1h-7z' +
    'M2 6h5v1h-5zM3 7h3v1h-3zM4 8h1v1h-1z',
  home:
    'M4 0h1v1h-1zM3 1h3v1h-3zM2 2h5v1h-5zM1 3h7v1h-7zM0 4h9v1h-9zM1 5h7v1h-7zM1 6h3v1h-3z' +
    'M5 6h3v1h-3zM1 7h3v1h-3zM5 7h3v1h-3zM1 8h3v1h-3zM5 8h3v1h-3z',
  layers:
    'M4 0h1v1h-1zM2 1h2v1h-2zM5 1h2v1h-2zM0 2h2v1h-2zM7 2h2v1h-2zM2 3h2v1h-2zM5 3h2v1h-2z' +
    'M0 4h1v1h-1zM4 4h1v1h-1zM8 4h1v1h-1zM1 5h2v1h-2zM6 5h2v1h-2zM3 6h3v1h-3z',
  lock:
    'M2 0h5v1h-5zM1 1h2v1h-2zM6 1h2v1h-2zM1 2h2v1h-2zM6 2h2v1h-2zM0 3h9v1h-9zM0 4h9v1h-9z' +
    'M0 5h4v1h-4zM5 5h4v1h-4zM0 6h4v1h-4zM5 6h4v1h-4zM0 7h9v1h-9z',
  mute:
    'M4 0h1v1h-1zM3 1h2v1h-2zM0 2h5v1h-5zM6 2h1v1h-1zM8 2h1v1h-1zM0 3h5v1h-5zM7 3h1v1h-1z' +
    'M0 4h5v1h-5zM6 4h1v1h-1zM8 4h1v1h-1zM0 5h5v1h-5zM3 6h2v1h-2zM4 7h1v1h-1z',
  out:
    'M0 0h4v1h-4zM0 1h1v1h-1zM0 2h1v1h-1zM5 2h1v1h-1zM0 3h1v1h-1zM2 3h7v1h-7zM0 4h1v1h-1z' +
    'M5 4h1v1h-1zM0 5h1v1h-1zM0 6h4v1h-4z',
  pause:
    'M2 1h2v1h-2zM6 1h2v1h-2zM2 2h2v1h-2zM6 2h2v1h-2zM2 3h2v1h-2zM6 3h2v1h-2zM2 4h2v1h-2z' +
    'M6 4h2v1h-2zM2 5h2v1h-2zM6 5h2v1h-2zM2 6h2v1h-2zM6 6h2v1h-2zM2 7h2v1h-2zM6 7h2v1h-2z',
  phone:
    'M2 0h5v1h-5zM2 1h1v1h-1zM6 1h1v1h-1zM2 2h1v1h-1zM6 2h1v1h-1zM2 3h1v1h-1zM6 3h1v1h-1z' +
    'M2 4h1v1h-1zM6 4h1v1h-1zM2 5h1v1h-1zM6 5h1v1h-1zM2 6h2v1h-2zM5 6h2v1h-2zM2 7h5v1h-5z',
  pip:
    'M0 0h9v1h-9zM0 1h1v1h-1zM8 1h1v1h-1zM0 2h1v1h-1zM8 2h1v1h-1zM0 3h1v1h-1zM4 3h3v1h-3z' +
    'M8 3h1v1h-1zM0 4h1v1h-1zM4 4h3v1h-3zM8 4h1v1h-1zM0 5h1v1h-1zM8 5h1v1h-1zM0 6h9v1h-9z',
  play: 'M1 1h2v1h-2zM1 2h4v1h-4zM1 3h6v1h-6zM1 4h7v1h-7zM1 5h6v1h-6zM1 6h4v1h-4zM1 7h2v1h-2z',
  rewind:
    'M4 1h1v1h-1zM8 1h1v1h-1zM3 2h2v1h-2zM7 2h2v1h-2zM2 3h3v1h-3zM6 3h3v1h-3zM1 4h8v1h-8z' +
    'M2 5h3v1h-3zM6 5h3v1h-3zM3 6h2v1h-2zM7 6h2v1h-2zM4 7h1v1h-1zM8 7h1v1h-1z',
  search:
    'M1 0h4v1h-4zM0 1h1v1h-1zM5 1h1v1h-1zM0 2h1v1h-1zM5 2h1v1h-1zM0 3h1v1h-1zM5 3h1v1h-1z' +
    'M0 4h1v1h-1zM5 4h1v1h-1zM1 5h4v1h-4zM5 6h2v1h-2zM6 7h2v1h-2zM7 8h2v1h-2z',
  sliders: 'M1 0h2v1h-2zM0 1h9v1h-9zM1 2h2v1h-2zM6 4h2v1h-2zM0 5h9v1h-9zM6 6h2v1h-2z',
  sort:
    'M2 0h1v1h-1zM1 1h3v1h-3zM0 2h5v1h-5zM2 3h1v1h-1zM5 3h1v1h-1zM2 4h1v1h-1zM5 4h1v1h-1z' +
    'M2 5h1v1h-1zM5 5h1v1h-1zM4 6h5v1h-5zM5 7h3v1h-3zM6 8h1v1h-1z',
  sparkle:
    'M4 0h1v1h-1zM4 1h1v1h-1zM4 2h1v1h-1zM3 3h3v1h-3zM0 4h9v1h-9zM3 5h3v1h-3zM4 6h1v1h-1z' +
    'M4 7h1v1h-1zM4 8h1v1h-1z',
  speaker:
    'M4 0h1v1h-1zM3 1h2v1h-2zM7 1h1v1h-1zM0 2h5v1h-5zM8 2h1v1h-1zM0 3h5v1h-5zM6 3h1v1h-1z' +
    'M8 3h1v1h-1zM0 4h5v1h-5zM6 4h1v1h-1zM8 4h1v1h-1zM0 5h5v1h-5zM8 5h1v1h-1zM3 6h2v1h-2z' +
    'M7 6h1v1h-1zM4 7h1v1h-1z',
  star:
    'M4 0h1v1h-1zM4 1h1v1h-1zM3 2h3v1h-3zM0 3h9v1h-9zM1 4h7v1h-7zM2 5h5v1h-5zM2 6h2v1h-2z' +
    'M5 6h2v1h-2zM1 7h2v1h-2zM6 7h2v1h-2zM1 8h1v1h-1zM7 8h1v1h-1z',
  tv:
    'M1 0h1v1h-1zM7 0h1v1h-1zM2 1h1v1h-1zM6 1h1v1h-1zM3 2h1v1h-1zM5 2h1v1h-1zM0 3h9v1h-9z' +
    'M0 4h1v1h-1zM8 4h1v1h-1zM0 5h1v1h-1zM8 5h1v1h-1zM0 6h1v1h-1zM8 6h1v1h-1zM0 7h9v1h-9z' +
    'M1 8h1v1h-1zM7 8h1v1h-1z',
};
