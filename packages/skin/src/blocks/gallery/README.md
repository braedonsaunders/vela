# Gallery rich blocks

The Gallery photo document binds `photoViewer.props.item` to
`{src.title.item}` from `vela.title`. The viewer uses the card’s thumbnail,
backdrop or poster in that order and retains the selected image’s aspect ratio.
The frame supplies its close control and scroll region. The block adds no TV
focus targets. The built-in title frame measures its viewport and the caption
so the picture, name and taken date fit when the photo opens. Facts and plugin
panels remain in the scroll region.

| Part | Styles | Element |
| --- | --- | --- |
| `photoViewer.root` | Box | Viewer container |
| `photoViewer.stage` | Box | Artwork viewport or placeholder |
| `photoViewer.metadata` | Box | Caption containing eyebrow, title and date |
| `photoViewer.eyebrow` | Text | Localized Photo label |
| `photoViewer.title` | Text | Photo name |
| `photoViewer.date` | Text | Taken day or year |
| `photoViewer.facts` | Box | Optional labels and values supplied by the server |

The document places the `gallery.photo.panel` plugin slot after the viewer
and passes its title record as context. The block exposes part styles.
