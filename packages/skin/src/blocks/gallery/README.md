# Gallery rich blocks

The Gallery photo document binds `photoViewer.props.item` to
`{src.title.item}` from `vela.title`. The viewer uses the card’s thumbnail,
backdrop or poster in that order and retains the selected image’s aspect ratio.
The title frame supplies its close control and scroll region. A viewer opened from
a Gallery grid keeps that grid's sequence and draws navigation controls. Direct
photo links show the photo and its facts. Both layouts measure the usable
frame and caption, shrinking the image stage only when needed to keep the
caption visible when the viewer opens.

| Part | Styles | Element |
| --- | --- | --- |
| `photoViewer.root` | Box | Viewer container |
| `photoViewer.stage` | Box | Artwork viewport or placeholder |
| `photoViewer.metadata` | Box | Caption containing eyebrow, title and date |
| `photoViewer.eyebrow` | Text | Localized Photo label |
| `photoViewer.title` | Text | Photo name |
| `photoViewer.date` | Text | Taken day or year |
| `photoViewer.facts` | Box | Optional labels and values supplied by the server |
| `photoViewer.transport` | Box | Info and fullscreen controls beside Close or in the fullscreen overlay |
| `photoViewer.control` | Box | Round chevron, info and fullscreen buttons |

The document places the `gallery.photo.panel` plugin slot after the viewer
and passes its title record as context. The block exposes part styles.

When a photo opens from a grid, the frame contributes Info and Full screen
beside Close. Previous and Next overlay the image and appear only when their
neighbour exists. The image's aspect ratio and the measured caption determine
its height. Fullscreen uses the same controls and hides them after three idle
seconds. Pointer, touch, keyboard and remote input reveal them again.

On touch, pinch to zoom or double-tap to toggle between fit and 2× at
the tap point. A drag pans within the enlarged image, and a horizontal
swipe at fit moves to the neighbouring photo. Changing photos resets the
zoom. The TV viewer uses its remote controls.
