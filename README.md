# MeetConnect

MeetConnect is a simple Zoom-like meeting app that runs locally with free/open-source tools only.

## Stack

- Frontend: React + Vite
- Styling: CSS
- Backend: Node.js + Express
- Real-time signaling: Socket.IO
- Video/audio: WebRTC
- Database: None

## Folder Structure

```text
client/
  src/
    main.jsx
    styles.css
  index.html
  package.json
server/
  index.js
  package.json
README.md
```

## Install

Install backend dependencies:

```bash
cd server
npm install
```

Install frontend dependencies:

```bash
cd ../client
npm install
```

## Run Locally

Start the backend signaling server:

```bash
cd server
npm start
```

Start the frontend:

```bash
cd client
npm run dev
```

Open the Vite URL, usually:

```text
http://localhost:5173
```

For local development, the frontend uses:

```text
VITE_SERVER_URL=http://localhost:5000
```

The backend allows local Vite origins by default. For deployment, set `CLIENT_ORIGIN` on the backend.

## Local Browser Tab Test

1. Open `http://localhost:5173`.
2. Click **Create Meeting**.
3. Copy the meeting link or room ID.
4. Open another browser tab.
5. Paste the meeting link, or enter your name and the same meeting ID.
6. Allow camera and microphone permissions in both tabs.
7. Video, audio, chat, mute, camera toggle, screen sharing, and leave should work between tabs.

## Where Main Features Are Implemented

- Home page, meeting creation, copyable link, join form: `client/src/main.jsx` in `Home`.
- Meeting room UI, video grid, control bar, participants panel, and chat panel: `client/src/main.jsx` in `MeetingRoom`, with styling in `client/src/styles.css`.
- WebRTC peer connections, media tracks, offers, answers, ICE candidates, screen sharing, mute, and camera controls: `client/src/main.jsx` in `MeetingRoom`.
- Socket.IO signaling events `join-room`, `user-connected`, `offer`, `answer`, `ice-candidate`, `user-disconnected`, and `chat-message`: `server/index.js`.
- Chat send, instant local display, Enter-to-send, message state, sender name, message text, and time rendering: `client/src/main.jsx` in `sendMessage` and the chat panel.
- Organizer/admin/user roles, participant list, mic/camera status, room lock, waiting room allow/deny, admin promotion/removal, participant mute/remove, and screen-share permission: `server/index.js` for room authority and `client/src/main.jsx` for controls.

## Roles and Permissions

- The first user who joins an empty room becomes the **Organizer**.
- Organizer can lock/unlock the meeting, allow/deny waiting users, mute/remove participants, make/remove admins, and allow/disable screen sharing for normal users.
- Organizer can end the meeting for everyone.
- Admin can mute/remove normal users.
- User can mute/unmute self, turn camera on/off, chat, and screen share only when allowed.
- A room may have an optional password. The first user who joins an empty room with a password sets that room password for the current in-memory session.

## Screenshots

Add final screenshots here after running the app locally or after deployment:

```text
docs/screenshots/home.png
docs/screenshots/prejoin.png
docs/screenshots/gallery-view.png
docs/screenshots/screen-share.png
docs/screenshots/waiting-room.png
```

Suggested captures:

- Home page with Create Meeting and Join Meeting.
- Prejoin screen with name and optional password.
- Gallery View with participant list and chat.
- Screen Sharing view with the large shared screen and bottom camera strip.
- Waiting Room screen shown when the meeting is locked.

## Deployment

No paid APIs are used. You can deploy with free-tier-friendly hosts. WebRTC media is peer-to-peer; Socket.IO is used only for signaling and room state.

### Frontend on Vercel

1. Push this project to GitHub.
2. Create a Vercel project using the `client` folder as the root directory.
3. Set build command:

```bash
npm run build
```

4. Set output directory:

```text
dist
```

5. Add environment variable:

```text
VITE_SERVER_URL=https://your-backend-url
```

6. Deploy.

`client/vercel.json` includes an SPA rewrite so meeting links such as `/room/ABCD1234` load correctly.

### Backend on Render

1. Create a new Web Service from the repository.
2. Use `server` as the root directory.
3. Set build command:

```bash
npm install
```

4. Set start command:

```bash
npm start
```

5. Add environment variables:

```text
PORT=5000
CLIENT_ORIGIN=https://your-vercel-app.vercel.app
```

Render may provide its own `PORT`; if so, keep the default platform value.

After the backend deploys, copy its public URL into the frontend `VITE_SERVER_URL` value and redeploy the Vercel frontend.

### Backend on Railway or Fly.io

Use the `server` folder as the app root, run `npm install`, and start with:

```bash
npm start
```

Set:

```text
CLIENT_ORIGIN=https://your-vercel-app.vercel.app
```

For multiple allowed frontend URLs, separate them with commas:

```text
CLIENT_ORIGIN=https://your-vercel-app.vercel.app,http://localhost:5173
```

## Environment Variables

Frontend `client/.env`:

```text
VITE_SERVER_URL=http://localhost:5000
```

Backend `server/.env`:

```text
PORT=5000
CLIENT_ORIGIN=http://localhost:5173,http://127.0.0.1:5173
```

Production example:

```text
VITE_SERVER_URL=https://meetconnect-backend.onrender.com
CLIENT_ORIGIN=https://meetconnect.vercel.app
```

## Deployment Checklist

- Backend responds at `/` with `status: signaling server running`.
- Frontend `VITE_SERVER_URL` points to the deployed backend URL.
- Backend `CLIENT_ORIGIN` includes the exact deployed frontend origin.
- Browser camera and microphone permissions are allowed for the frontend URL.
- Meeting links load directly on refresh because Vercel rewrites are enabled.
- If testing across strict networks, consider adding a free/self-hosted TURN option later; local and many common networks work with the included free STUN server.

## Notes

- This app uses a public free STUN server for local WebRTC discovery: `stun:stun.l.google.com:19302`.
- No paid APIs, SDKs, subscription services, or database are used.
- For same-machine local tab testing, a TURN server is usually not required. For production or difficult networks, you may need to add a TURN server later.
- Room state is kept in backend memory. Restarting the backend clears active rooms, which keeps the app simple and database-free.
- Current WebRTC peer-to-peer version is best for 2-8 users. For 40-80 users, migrate to LiveKit/Jitsi/mediasoup SFU.

## Production Testing Checklist

Run these checks after every Vercel/Railway deploy:

- Open the frontend Vercel URL and create a meeting.
- Join from a second browser/device using the same meeting link.
- Confirm local video is muted locally and remote audio plays from the other participant.
- Toggle camera off/on and confirm other participants see the update without reconnecting.
- Start screen share and confirm the warning appears before browser sharing selection.
- Stop screen share and confirm Gallery View returns.
- Use reactions and Raise Hand; confirm participants see them.
- Organizer: test Mute All, lock/unlock, enable/disable chat, enable/disable participant screen sharing, remove participant, make/remove admin, and end meeting.
- Chat: confirm sender name, time, emoji insertion, and system messages.
- Mobile: confirm sticky bottom controls and bottom-sheet Participants/Chat panels.
- Railway backend `/` should return `status: signaling server running`.

## Push and Redeploy Commands

Commit and push:

```bash
git status
git add client server README.md
git commit -m "Polish MeetConnect deployment UI and room controls"
git push origin main
```

Vercel:

```bash
cd client
npm run build
```

Then redeploy from the Vercel dashboard, or let Vercel auto-deploy from the pushed `main` branch.

Railway:

```bash
cd server
npm start
```

Then redeploy from the Railway dashboard, or let Railway auto-deploy from the pushed `main` branch.

Keep these environment variables unchanged:

```text
Vercel frontend:
VITE_SERVER_URL=https://your-railway-backend-url

Railway backend:
CLIENT_ORIGIN=https://your-vercel-frontend-url
```
