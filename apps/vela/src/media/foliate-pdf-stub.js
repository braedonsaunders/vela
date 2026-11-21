// foliate-js's view.js imports its own pdf.js for PDFs. Vela opens PDFs through its own adapter
// (pdf-book.web.ts), and foliate's module does not survive the release minifier, so Metro maps
// that import here instead.
export const makePDF = () => { throw new Error('PDFs open through Vela\'s PDF adapter'); };
