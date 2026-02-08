import { serve } from "bun";
import { join } from "path";

const root = join(import.meta.dir, "..");

serve({
  port: 3000,
  async fetch(req) {
    const url = new URL(req.url);
    let path = url.pathname === "/" ? "/index.html" : url.pathname;
    const file = Bun.file(join(root, path.slice(1) || "index.html"));
    if (await file.exists()) {
      return new Response(file);
    }
    return new Response("Not found", { status: 404 });
  },
});

console.log("Map server at http://localhost:3000");
