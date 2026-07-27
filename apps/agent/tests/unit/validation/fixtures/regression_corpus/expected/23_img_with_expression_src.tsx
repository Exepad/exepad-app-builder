// Provenance: urls_images audit. The hallucinated-URL fixer uses
// ``re.sub(r"<img\\b[^>]*?>", _fix_img_tag_urls, tsx, ...)`` to scope
// URL substitution to <img> tags. The pattern stops at the first ``>``,
// which can mis-segment ``<img src={getUrl(">")}>`` (a ``>`` inside a
// JSX expression body) — but the inner regex only mutates ``src=``
// attribute values containing literal http(s) URLs, so dynamic-src
// JSX should pass through unchanged.
//
// Expected:
//   - ``<img src="https://via.placeholder.com/...">`` → ExepadImage
//     (or __PLACEHOLDER__, depending on the dispatch).
//   - ``<img src={getImageUrl(item)} />`` → unchanged (dynamic src,
//     not a literal URL).

import { ExepadImage, React } from '@exepad/sdk';

const items = [{ id: 1, name: "alpha" }];
const getImageUrl = (item: { id: number }) => "/dynamic/" + item.id;

const C = () => (
  <div className="flex gap-2">
    <ExepadImage keywords="static placeholder with detailed scene and natural lighting" importance={5} className="w-12 h-12" width={800} height={600} />
    <img src={getImageUrl(items[0])} alt="dynamic" className="w-12 h-12" />
  </div>
);

export default C;
