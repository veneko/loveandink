// /tinylegends/assets/sq/<IMAGE_ID>.webp -> the Square-hosted product photo.
import { wrap, sq, HttpError } from '../lib/lib.mjs';
export default wrap(async req => {
  const id = (new URL(req.url).searchParams.get('id') || '').replace(/\.webp$/, '');
  if (!/^[A-Z0-9]{10,40}$/i.test(id)) throw new HttpError(404, 'Not found');
  const d = await sq('/v2/catalog/object/' + id, { method: 'GET' });
  const url = d.object && d.object.image_data && d.object.image_data.url; if (!url) throw new HttpError(404, 'Not found');
  return new Response(null, { status: 302, headers: { Location: url, 'Cache-Control': 'public, max-age=3600', 'Netlify-CDN-Cache-Control': 'public, s-maxage=86400' } });
});
