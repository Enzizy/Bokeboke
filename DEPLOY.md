# Putting Wobble Wars online

Two pieces, two free hosts:

- **The game page** (`client/`) is static files - Cloudflare Pages serves it.
- **The match server** (`server/`) is a Node process that has to stay running - Render runs it.

Both deploy from a GitHub repository and redeploy by themselves whenever you push.

Total cost: nothing. The catch: Render's free server sleeps after about 15 minutes with
nobody connected, and the first person to connect after that waits roughly a minute while it
wakes. The game says *"Waking the server... (20s)"* rather than looking broken, so just wait.

---

## 1. Put the project on GitHub

1. Create an empty repository at <https://github.com/new> (call it `wobble-wars`; public or
   private both work). Don't add a README or licence - the project already has them.
2. In a terminal in this folder:

   ```
   git init
   git add .
   git commit -m "Wobble Wars"
   git branch -M main
   git remote add origin https://github.com/YOUR-NAME/wobble-wars.git
   git push -u origin main
   ```

`.gitignore` leaves out `node_modules`, build output, and the FBX/OBJ copies in the asset
packs (the game only loads GLB/glTF), so the push is about 15 MB rather than 50.

## 2. Deploy the match server on Render

1. Sign up at <https://render.com> with your GitHub account. No card needed for the free plan.
2. **New → Blueprint**, pick the `wobble-wars` repository. Render reads `render.yaml` and sets
   everything up. Click **Apply**.
3. Wait for the first build (a few minutes). When it says **Live**, open the URL it shows -
   something like `https://wobble-wars-server.onrender.com`. You should see:

   ```
   wobble-wars: awake, 0 room(s)
   ```

4. Write that URL down with `wss://` instead of `https://` - that is your **server URL**:

   ```
   wss://wobble-wars-server.onrender.com
   ```

## 3. Deploy the game page on Cloudflare Pages

1. Sign up at <https://dash.cloudflare.com>. No card needed.
2. **Workers & Pages → Create → Pages → Connect to Git**, pick the `wobble-wars` repository.
3. Build settings:

   | Setting | Value |
   |---|---|
   | Framework preset | None |
   | Build command | `npm run build` |
   | Build output directory | `client/dist` |

4. **Environment variables** (same screen, under *Advanced*):

   | Name | Value |
   |---|---|
   | `VITE_SERVER_URL` | your server URL from step 2, e.g. `wss://wobble-wars-server.onrender.com` |
   | `NODE_VERSION` | `22` |

5. **Save and Deploy.** You get a URL like `https://wobble-wars.pages.dev`. That's the game.

## 4. Play

Open the `pages.dev` URL, type a name, **Create a room**, and read the code out to your
friends. They open the same URL and **Join** with it. The first connection of the day may take
up to a minute while the server wakes.

## Updating

Push to GitHub. Both hosts rebuild on their own:

```
git add .
git commit -m "what changed"
git push
```

If you change the protocol (anything in `shared/src/net/messages.ts`), deploy both - an old
page talking to a new server is told to reload rather than misbehaving, but it can't play.

## Also putting it on itch.io

itch.io only hosts the page, so it uses the same Render server:

1. Build with the server URL baked in:

   ```
   set VITE_SERVER_URL=wss://wobble-wars-server.onrender.com
   npm run build
   ```

   (in PowerShell: `$env:VITE_SERVER_URL="wss://wobble-wars-server.onrender.com"; npm run build`)

2. Zip the **contents** of `client/dist` - `index.html` has to be at the top of the zip, not
   inside a folder.
3. On itch.io: **Create new project → Kind: HTML**, upload the zip, tick **This file will be
   played in the browser**, set the viewport to 1280 x 720 or larger.

## When something goes wrong

| What you see | What it means |
|---|---|
| "Waking the server... (40s)" | Normal after a quiet spell. Give it a minute. |
| "Gave up waiting for wss://..." | The server didn't wake. Open its Render URL in a browser; check the Render dashboard logs. |
| "Could not reach ws://..." (note: `ws`, not `wss`) | `VITE_SERVER_URL` wasn't set when the page was built. Set it in Cloudflare and redeploy. |
| "Server speaks protocol N, you speak M" | Page and server are different versions. Redeploy whichever is older, then reload. |
| The page loads but shows no characters | Asset paths broke. Check `npm run build` locally prints "copied ... MB of models". |

Rooms live in the server's memory, so if Render restarts it (a deploy, or waking from sleep),
any rooms in progress are gone and everyone re-creates one. Matches are short; it's fine.
