const SETS = new Set(["neo", "classic", "wood"]);
const CODES = new Set(["wp", "wn", "wb", "wr", "wq", "wk", "bp", "bn", "bb", "br", "bq", "bk"]);

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const set = searchParams.get("set") ?? "";
  const code = searchParams.get("code") ?? "";
  if (!SETS.has(set) || !CODES.has(code)) {
    return Response.json({ error: "Unknown piece." }, { status: 400 });
  }
  const upstream = await fetch(
    `https://images.chesscomfiles.com/chess-themes/pieces/${set}/150/${code}.png`,
    { headers: { "User-Agent": "Beside/1.0 (Chess.com study coach)" } },
  );
  if (!upstream.ok) {
    return Response.json({ error: "Chess.com piece art could not be loaded." }, { status: 502 });
  }
  const bytes = await upstream.arrayBuffer();
  return new Response(bytes, {
    headers: {
      "Content-Type": "image/png",
      "Cache-Control": "public, max-age=86400",
    },
  });
}
