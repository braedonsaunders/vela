# Gallery rich blocks

The Gallery photo document binds `photoViewer.props.item` to
`{src.title.item}` from `vela.title`. The viewer uses the card’s thumbnail,
backdrop or poster in that order and retains the selected image’s aspect ratio.
The title frame supplies its close control and scroll region. A viewer opened from
a Gallery grid keeps that grid's sequence and draws navigation controls. Direct
photo links keep the standalone photo and its facts.

| Part | Styles | Element |
| --- | --- | --- |
| `photoViewer.root` | Box | Viewer container |
| `photoViewer.stage` | Box | Artwork viewport or placeholder |
| `photoViewer.metadata` | Box | Caption containing eyebrow, title and date |
| `photoViewer.eyebrow` | Text | Localized Photo label |
| `photoViewer.title` | Text | Photo name |
| `photoViewer.date` | Text | Taken day or year |
| `photoViewer.facts` | Box | Optional labels and values supplied by the server |
| `photoViewer.transport` | Box | Navigation and display controls |
| `photoViewer.control` | Box, text | Each control and its label |

The document places the `gallery.photo.panel` plugin slot after the viewer
and passes its title record as context. The block exposes part styles.
