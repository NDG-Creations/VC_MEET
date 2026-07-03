import React, { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { io } from "socket.io-client";
import {
  Camera,
  CameraOff,
  Clipboard,
  Copy,
  Crown,
  KeyRound,
  Link as LinkIcon,
  LoaderCircle,
  Lock,
  LockOpen,
  LogOut,
  Mic,
  MicOff,
  MonitorUp,
  Phone,
  Power,
  Send,
  Shield,
  ShieldMinus,
  UserCheck,
  UserMinus,
  Users
} from "lucide-react";
import "./styles.css";

const SIGNALING_SERVER =
  import.meta.env.VITE_SERVER_URL ||
  import.meta.env.VITE_SIGNALING_SERVER ||
  "http://localhost:5000";

const rtcConfig = {
  iceServers: [{ urls: "stun:stun.l.google.com:19302" }]
};

function generateRoomId() {
  const id = crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`;
  return id.split("-")[0].toUpperCase();
}

function getInitialRoute() {
  const { pathname, search } = window.location;
  const params = new URLSearchParams(search);

  if (pathname.startsWith("/room/")) {
    return {
      page: "room",
      roomId: pathname.replace("/room/", ""),
      name: params.get("name") || "",
      password: params.get("password") || ""
    };
  }

  return { page: "home", roomId: "", name: "", password: "" };
}

function navigate(path) {
  window.history.pushState({}, "", path);
  window.dispatchEvent(new PopStateEvent("popstate"));
}

function formatTime(timestamp) {
  return new Intl.DateTimeFormat(undefined, {
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(timestamp));
}

function createId() {
  return crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`;
}

function App() {
  const [route, setRoute] = useState(getInitialRoute);

  useEffect(() => {
    const onRouteChange = () => setRoute(getInitialRoute());
    window.addEventListener("popstate", onRouteChange);
    return () => window.removeEventListener("popstate", onRouteChange);
  }, []);

  if (route.page === "room") {
    return <MeetingRoom roomId={route.roomId} initialName={route.name} initialPassword={route.password} />;
  }

  return <Home />;
}

function Home() {
  const [createdRoomId, setCreatedRoomId] = useState("");
  const [createPassword, setCreatePassword] = useState("");
  const [copied, setCopied] = useState(false);
  const [joinName, setJoinName] = useState("");
  const [joinRoomId, setJoinRoomId] = useState("");
  const [joinPassword, setJoinPassword] = useState("");

  const meetingLink = useMemo(() => {
    if (!createdRoomId) return "";
    return `${window.location.origin}/room/${createdRoomId}`;
  }, [createdRoomId]);

  const createMeeting = () => {
    setCopied(false);
    setCreatedRoomId(generateRoomId());
  };

  const copyMeetingLink = async () => {
    if (!meetingLink) return;
    await navigator.clipboard.writeText(meetingLink);
    setCopied(true);
  };

  const joinMeeting = (event) => {
    event.preventDefault();
    const roomId = joinRoomId.trim().toUpperCase();
    const name = joinName.trim();

    if (!roomId || !name) return;
    const passwordQuery = joinPassword.trim()
      ? `&password=${encodeURIComponent(joinPassword.trim())}`
      : "";
    navigate(`/room/${roomId}?name=${encodeURIComponent(name)}${passwordQuery}`);
  };

  return (
    <main className="home-shell">
      <section className="home-panel">
        <div className="brand-mark">
          <Phone size={34} />
        </div>
        <h1>MeetConnect</h1>
        <p className="home-copy">Simple browser meetings with WebRTC video, audio, chat, and screen sharing.</p>

        <div className="home-actions">
          <button className="primary-btn" type="button" onClick={createMeeting}>
            Create Meeting
          </button>
          <a className="secondary-btn" href="#join">
            Join Meeting
          </a>
        </div>

        <label className="home-password">
          Meeting password optional
          <input
            value={createPassword}
            onChange={(event) => setCreatePassword(event.target.value)}
            placeholder="Leave blank for no password"
            type="password"
          />
        </label>

        {createdRoomId && (
          <div className="meeting-link-box" aria-live="polite">
            <span>Meeting ID</span>
            <strong>{createdRoomId}</strong>
            <div className="copy-row">
              <input readOnly value={meetingLink} aria-label="Meeting link" />
              <button type="button" onClick={copyMeetingLink} title="Copy meeting link">
                {copied ? <Clipboard size={18} /> : <Copy size={18} />}
              </button>
            </div>
            <button
              className="primary-btn wide"
              type="button"
              onClick={() => {
                const passwordQuery = createPassword.trim()
                  ? `?password=${encodeURIComponent(createPassword.trim())}`
                  : "";
                navigate(`/room/${createdRoomId}${passwordQuery}`);
              }}
            >
              Enter Room
            </button>
          </div>
        )}
      </section>

      <section id="join" className="join-panel">
        <h2>Join Meeting</h2>
        <form onSubmit={joinMeeting}>
          <label>
            Your name
            <input
              value={joinName}
              onChange={(event) => setJoinName(event.target.value)}
              placeholder="Alex"
              required
            />
          </label>
          <label>
            Meeting ID
            <input
              value={joinRoomId}
              onChange={(event) => setJoinRoomId(event.target.value)}
              placeholder="A1B2C3D4"
              required
            />
          </label>
          <label>
            Meeting password optional
            <input
              value={joinPassword}
              onChange={(event) => setJoinPassword(event.target.value)}
              placeholder="Password if required"
              type="password"
            />
          </label>
          <button className="primary-btn wide" type="submit">
            Join Meeting
          </button>
        </form>
      </section>
    </main>
  );
}

function MeetingRoom({ roomId, initialName, initialPassword }) {
  const socketRef = useRef(null);
  const localVideoRef = useRef(null);
  const localStreamRef = useRef(null);
  const screenStreamRef = useRef(null);
  const peersRef = useRef(new Map());
  const screenSendersRef = useRef(new Map());
  const micOnRef = useRef(true);
  const cameraOnRef = useRef(true);
  const isSharingScreenRef = useRef(false);
  const remoteCamerasRef = useRef([]);

  const [name, setName] = useState(initialName || "");
  const [password, setPassword] = useState(initialPassword || "");
  const [hasJoined, setHasJoined] = useState(Boolean(initialName));
  const [isJoining, setIsJoining] = useState(false);
  const [isWaitingRoom, setIsWaitingRoom] = useState(false);
  const [joinError, setJoinError] = useState("");
  const [copiedMeetingLink, setCopiedMeetingLink] = useState(false);
  const [mySocketId, setMySocketId] = useState("");
  const [role, setRole] = useState("user");
  const [participants, setParticipants] = useState([]);
  const [pendingRequests, setPendingRequests] = useState([]);
  const [isLocked, setIsLocked] = useState(false);
  const [canShareScreen, setCanShareScreen] = useState(false);
  const [remoteCameras, setRemoteCameras] = useState([]);
  const [activeShare, setActiveShare] = useState(null);
  const [viewMode, setViewMode] = useState("gallery");
  const [messages, setMessages] = useState([]);
  const [chatInput, setChatInput] = useState("");
  const [isMicOn, setIsMicOn] = useState(true);
  const [isCameraOn, setIsCameraOn] = useState(true);
  const [isSharingScreen, setIsSharingScreen] = useState(false);
  const [mediaError, setMediaError] = useState("");
  const [roomNotice, setRoomNotice] = useState("");

  const myParticipant = participants.find((participant) => participant.id === mySocketId);
  const canManageRoom = role === "organizer";
  const meetingLink = `${window.location.origin}/room/${roomId}`;

  useEffect(() => {
    micOnRef.current = isMicOn;
  }, [isMicOn]);

  useEffect(() => {
    cameraOnRef.current = isCameraOn;
  }, [isCameraOn]);

  useEffect(() => {
    isSharingScreenRef.current = isSharingScreen;
  }, [isSharingScreen]);

  useEffect(() => {
    remoteCamerasRef.current = remoteCameras;
  }, [remoteCameras]);

  useEffect(() => {
    if (!hasJoined || !name.trim()) return undefined;

    let isMounted = true;
    const socket = io(SIGNALING_SERVER);
    socketRef.current = socket;

    socket.on("joined-room", ({ socketId, role, locked, participants, pendingRequests, canShareScreen }) => {
      setIsJoining(false);
      setIsWaitingRoom(false);
      setJoinError("");
      setMySocketId(socketId);
      setRole(role);
      setIsLocked(Boolean(locked));
      setParticipants(participants || []);
      setPendingRequests(pendingRequests || []);
      setCanShareScreen(Boolean(canShareScreen));
      setRoomNotice("");
    });

    socket.on("waiting-room", () => {
      setIsJoining(false);
      setIsWaitingRoom(true);
      setRoomNotice("The meeting is locked. Waiting for the organizer to let you in.");
    });

    socket.on("join-approved", () => {
      setIsWaitingRoom(false);
      setRoomNotice("You were admitted to the meeting.");
    });

    socket.on("join-error", ({ message }) => {
      setIsJoining(false);
      setJoinError(message || "Could not join this meeting.");
      stopAllMedia();
      socket.disconnect();
      setHasJoined(false);
    });

    socket.on("join-denied", ({ reason }) => {
      setIsJoining(false);
      setIsWaitingRoom(false);
      setRoomNotice(reason || "Your request to join was denied.");
      stopAllMedia();
      socket.disconnect();
      setHasJoined(false);
    });

    socket.on("participants-updated", ({ participants, locked, pendingRequests }) => {
      setParticipants(participants || []);
      setIsLocked(Boolean(locked));
      setPendingRequests(pendingRequests || []);
      const self = participants?.find((participant) => participant.id === socket.id);
      if (self) {
        setRole(self.role);
        setCanShareScreen(Boolean(self.canShareScreen));
      }
    });

    socket.on("pending-requests", (requests) => {
      setPendingRequests(requests || []);
    });

    socket.on("role-updated", ({ role, canShareScreen }) => {
      setRole(role);
      setCanShareScreen(Boolean(canShareScreen));
    });

    socket.on("screen-share-permission", ({ canShareScreen }) => {
      setCanShareScreen(Boolean(canShareScreen));
    });

    socket.on("force-mute", () => {
      const audioTrack = localStreamRef.current?.getAudioTracks()[0];
      if (audioTrack) audioTrack.enabled = false;
      setIsMicOn(false);
      socket.emit("participant-status", { micOn: false, cameraOn: cameraOnRef.current });
    });

    socket.on("removed-from-room", ({ reason }) => {
      alert(reason || "You were removed from the meeting.");
      leaveMeeting();
    });

    socket.on("meeting-ended", ({ reason }) => {
      alert(reason || "The meeting has ended.");
      leaveMeeting();
    });

    socket.on("user-connected", async ({ socketId, name: remoteName }) => {
      const peer = getOrCreatePeer(socketId, remoteName || "Guest");

      const offer = await peer.createOffer();
      await peer.setLocalDescription(offer);
      socket.emit("offer", { target: socketId, offer, name: name.trim() });
    });

    socket.on("offer", async ({ from, offer, name: remoteName }) => {
      const peer = getOrCreatePeer(from, remoteName || "Guest");

      await peer.setRemoteDescription(new RTCSessionDescription(offer));
      const answer = await peer.createAnswer();
      await peer.setLocalDescription(answer);
      socket.emit("answer", { target: from, answer });
    });

    socket.on("answer", async ({ from, answer }) => {
      const peer = peersRef.current.get(from);
      if (peer) {
        await peer.setRemoteDescription(new RTCSessionDescription(answer));
      }
    });

    socket.on("ice-candidate", async ({ from, candidate }) => {
      const peer = peersRef.current.get(from);
      if (peer && candidate) {
        await peer.addIceCandidate(new RTCIceCandidate(candidate));
      }
    });

    socket.on("user-disconnected", (socketId) => {
      closePeer(socketId);
    });

    socket.on("chat-message", (message) => {
      setMessages((current) => upsertMessage(current, message));
    });

    async function startMeeting() {
      setIsJoining(true);
      setJoinError("");
      setMediaError("");
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: true,
          audio: true
        });

        if (!isMounted) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }

        localStreamRef.current = stream;
        if (localVideoRef.current) {
          localVideoRef.current.srcObject = stream;
        }
      } catch (error) {
        const message =
          error?.name === "NotAllowedError" || error?.name === "PermissionDeniedError"
            ? "Camera or microphone permission was denied. You can still join, but your audio/video will be off until browser permissions are allowed."
            : "Camera or microphone could not be started. You can still join without media.";
        setMediaError(message);
        localStreamRef.current = new MediaStream();
        console.error(error);
      }

      socket.emit("join-room", {
        roomId,
        name: name.trim(),
        password: password.trim()
      });
    }

    startMeeting();

    return () => {
      isMounted = false;
      socket.disconnect();
      stopAllMedia();
      peersRef.current.forEach((peer) => peer.close());
      peersRef.current.clear();
      screenSendersRef.current.clear();
      setRemoteCameras([]);
      setActiveShare(null);
    };
  }, [hasJoined, name, password, roomId]);

  function upsertMessage(current, message) {
    const existingIndex = current.findIndex(
      (item) =>
        item.id === message.id ||
        (message.clientMessageId && item.clientMessageId === message.clientMessageId)
    );

    if (existingIndex === -1) return [...current, message];

    return current.map((item, index) => (index === existingIndex ? { ...item, ...message } : item));
  }

  function getOrCreatePeer(socketId, remoteName) {
    const existing = peersRef.current.get(socketId);
    if (existing) {
      existing.remoteName = remoteName || existing.remoteName;
      return existing;
    }

    const peer = createPeer(socketId, remoteName);
    peersRef.current.set(socketId, peer);
    return peer;
  }

  function createPeer(socketId, remoteName) {
    const peer = new RTCPeerConnection(rtcConfig);
    peer.remoteName = remoteName;
    const stream = localStreamRef.current;

    if (stream) {
      stream.getTracks().forEach((track) => peer.addTrack(track, stream));
    }

    const screenStream = screenStreamRef.current;
    const screenTrack = screenStream?.getVideoTracks()[0];
    if (screenTrack) {
      const sender = peer.addTrack(screenTrack, screenStream);
      screenSendersRef.current.set(socketId, sender);
    }

    peer.onicecandidate = (event) => {
      if (event.candidate) {
        socketRef.current?.emit("ice-candidate", {
          target: socketId,
          candidate: event.candidate
        });
      }
    };

    peer.ontrack = (event) => {
      const [remoteStream] = event.streams;
      if (!remoteStream || event.track.kind !== "video") return;

      const existing = remoteCamerasRef.current.find((item) => item.socketId === socketId);
      const isScreenTrack = Boolean(existing && existing.stream.id !== remoteStream.id);

      if (isScreenTrack) {
        showRemoteScreenShare(socketId, remoteName, remoteStream, event.track);
        return;
      }

      setRemoteCameras((current) => {
        if (existing) {
          const next = current.map((item) =>
            item.socketId === socketId ? { ...item, stream: remoteStream, name: remoteName } : item
          );
          remoteCamerasRef.current = next;
          return next;
        }
        const next = [...current, { socketId, stream: remoteStream, name: remoteName }];
        remoteCamerasRef.current = next;
        return next;
      });
    };

    peer.onconnectionstatechange = () => {
      if (["closed", "disconnected", "failed"].includes(peer.connectionState)) {
        closePeer(socketId);
      }
    };

    return peer;
  }

  function closePeer(socketId) {
    const peer = peersRef.current.get(socketId);
    if (peer) {
      peer.close();
      peersRef.current.delete(socketId);
    }

    setRemoteCameras((current) => current.filter((item) => item.socketId !== socketId));
    setActiveShare((current) => (current?.socketId === socketId ? null : current));
  }

  function stopAllMedia() {
    localStreamRef.current?.getTracks().forEach((track) => track.stop());
    screenStreamRef.current?.getTracks().forEach((track) => track.stop());
  }

  function toggleMic() {
    const audioTrack = localStreamRef.current?.getAudioTracks()[0];
    if (!audioTrack) return;
    audioTrack.enabled = !audioTrack.enabled;
    setIsMicOn(audioTrack.enabled);
    socketRef.current?.emit("participant-status", {
      micOn: audioTrack.enabled,
      cameraOn: cameraOnRef.current
    });
  }

  function toggleCamera() {
    const videoTrack = localStreamRef.current?.getVideoTracks()[0];
    if (!videoTrack) return;
    videoTrack.enabled = !videoTrack.enabled;
    setIsCameraOn(videoTrack.enabled);
    socketRef.current?.emit("participant-status", {
      micOn: micOnRef.current,
      cameraOn: videoTrack.enabled
    });
  }

  async function renegotiatePeer(peer, target) {
    const offer = await peer.createOffer();
    await peer.setLocalDescription(offer);
    socketRef.current?.emit("offer", { target, offer, name: name.trim() });
  }

  async function renegotiateAllPeers() {
    const jobs = [];
    peersRef.current.forEach((peer, target) => {
      jobs.push(renegotiatePeer(peer, target));
    });
    await Promise.all(jobs);
  }

  async function stopLocalScreenShare({ renegotiate = true } = {}) {
    screenStreamRef.current?.getTracks().forEach((track) => track.stop());
    screenStreamRef.current = null;

    peersRef.current.forEach((peer, target) => {
      const sender = screenSendersRef.current.get(target);
      if (sender) {
        peer.removeTrack(sender);
      }
    });
    screenSendersRef.current.clear();
    setIsSharingScreen(false);
    setActiveShare((current) => (current?.isLocal ? null : current));

    if (renegotiate) {
      await renegotiateAllPeers();
    }
  }

  function showRemoteScreenShare(socketId, remoteName, stream, track) {
    if (isSharingScreenRef.current) {
      stopLocalScreenShare();
    }

    setActiveShare({
      socketId,
      name: remoteName || "Guest",
      stream,
      isLocal: false
    });

    track.onended = () => {
      setActiveShare((current) => (current?.socketId === socketId ? null : current));
    };
    track.onmute = () => {
      setActiveShare((current) => (current?.socketId === socketId ? null : current));
    };
    stream.onremovetrack = () => {
      setActiveShare((current) => (current?.socketId === socketId ? null : current));
    };
  }

  async function toggleScreenShare() {
    if (!canShareScreen) {
      setRoomNotice("Screen sharing is not enabled for your role.");
      return;
    }

    if (isSharingScreen) {
      await stopLocalScreenShare();
      return;
    }

    try {
      const screenStream = await navigator.mediaDevices.getDisplayMedia({ video: true });
      const screenTrack = screenStream.getVideoTracks()[0];
      screenStreamRef.current = screenStream;
      setActiveShare({
        socketId: mySocketId || "local",
        name: name.trim(),
        stream: screenStream,
        isLocal: true
      });

      peersRef.current.forEach((peer, target) => {
        const sender = peer.addTrack(screenTrack, screenStream);
        screenSendersRef.current.set(target, sender);
      });
      await renegotiateAllPeers();

      screenTrack.onended = () => {
        stopLocalScreenShare();
      };

      setIsSharingScreen(true);
    } catch (error) {
      console.error(error);
    }
  }

  function sendMessage(event) {
    event.preventDefault();
    const message = chatInput.trim();
    if (!message) return;
    if (!mySocketId) {
      setRoomNotice("You can chat after you are admitted to the meeting.");
      return;
    }

    const optimisticMessage = {
      id: `local-${createId()}`,
      clientMessageId: createId(),
      socketId: socketRef.current?.id,
      name: name.trim(),
      message,
      timestamp: new Date().toISOString()
    };

    setMessages((current) => upsertMessage(current, optimisticMessage));
    socketRef.current?.emit("chat-message", {
      roomId,
      message,
      name: name.trim(),
      timestamp: optimisticMessage.timestamp,
      clientMessageId: optimisticMessage.clientMessageId
    });
    setChatInput("");
  }

  function leaveMeeting() {
    stopAllMedia();
    socketRef.current?.disconnect();
    navigate("/");
  }

  async function copyMeetingLink() {
    await navigator.clipboard.writeText(meetingLink);
    setCopiedMeetingLink(true);
    window.setTimeout(() => setCopiedMeetingLink(false), 1800);
  }

  function endMeetingForEveryone() {
    const shouldEnd = window.confirm("End this meeting for everyone?");
    if (shouldEnd) {
      socketRef.current?.emit("end-meeting");
    }
  }

  function setRoomLock(locked) {
    socketRef.current?.emit("set-lock", { locked });
  }

  function allowUser(socketId) {
    socketRef.current?.emit("allow-user", { socketId });
  }

  function denyUser(socketId) {
    socketRef.current?.emit("deny-user", { socketId });
  }

  function muteParticipant(target) {
    socketRef.current?.emit("mute-participant", { target });
  }

  function removeParticipant(target) {
    socketRef.current?.emit("remove-participant", { target });
  }

  function makeAdmin(target) {
    socketRef.current?.emit("make-admin", { target });
  }

  function removeAdmin(target) {
    socketRef.current?.emit("remove-admin", { target });
  }

  function setScreenSharePermission(target, canShareScreen) {
    socketRef.current?.emit("set-screen-share-permission", { target, canShareScreen });
  }

  if (!hasJoined) {
    return (
      <main className="prejoin-shell">
        <section className="prejoin-panel">
          <h1>Join {roomId}</h1>
          {joinError && <div className="media-error">{joinError}</div>}
          {roomNotice && <div className="room-notice">{roomNotice}</div>}
          <form
            onSubmit={(event) => {
              event.preventDefault();
              if (name.trim()) {
                setJoinError("");
                setRoomNotice("");
                setHasJoined(true);
              }
            }}
          >
            <label>
              Your name
              <input
                autoFocus
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="Alex"
                required
              />
            </label>
            <label>
              Meeting password optional
              <input
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                placeholder="Password if required"
                type="password"
              />
            </label>
            <button className="primary-btn wide" type="submit" disabled={isJoining}>
              {isJoining ? (
                <>
                  <LoaderCircle className="spin-icon" size={18} />
                  Joining...
                </>
              ) : (
                "Join Meeting"
              )}
            </button>
          </form>
        </section>
      </main>
    );
  }

  if (isWaitingRoom && !mySocketId) {
    return (
      <main className="prejoin-shell">
        <section className="prejoin-panel waiting-room-panel">
          <div className="brand-mark">
            <Lock size={32} />
          </div>
          <h1>Waiting Room</h1>
          <p className="home-copy">The meeting is locked. The organizer can allow or deny your request.</p>
          <div className="waiting-spinner">
            <LoaderCircle className="spin-icon" size={22} />
            Waiting for approval
          </div>
          {mediaError && <div className="media-error">{mediaError}</div>}
          <button className="secondary-btn wide" type="button" onClick={leaveMeeting}>
            Leave
          </button>
        </section>
      </main>
    );
  }

  if (isJoining && !mySocketId) {
    return (
      <main className="prejoin-shell">
        <section className="prejoin-panel waiting-room-panel">
          <div className="brand-mark">
            <LoaderCircle className="spin-icon" size={32} />
          </div>
          <h1>Joining</h1>
          <p className="home-copy">Starting camera and microphone, then connecting to the meeting.</p>
          {mediaError && <div className="media-error">{mediaError}</div>}
        </section>
      </main>
    );
  }

  return (
    <main className="meeting-shell">
      <section className="meeting-stage">
        <header className="meeting-header">
          <div>
            <span>MeetConnect</span>
            <strong>{roomId}</strong>
          </div>
          <div className="meeting-status">
            <button className="header-action" type="button" onClick={copyMeetingLink} title="Copy meeting link">
              {copiedMeetingLink ? <Clipboard size={17} /> : <LinkIcon size={17} />}
              <span>{copiedMeetingLink ? "Copied" : "Copy Link"}</span>
            </button>
            {canManageRoom && (
              <button
                className="header-action danger-action"
                type="button"
                onClick={endMeetingForEveryone}
                title="End meeting for everyone"
              >
                <Power size={17} />
                <span>End</span>
              </button>
            )}
            <span className={`role-badge ${role}`}>{role}</span>
            <div className="participant-count">
              <Users size={18} />
              {participants.length || remoteCameras.length + 1}
            </div>
          </div>
        </header>

        {mediaError && <div className="media-error">{mediaError}</div>}
        {roomNotice && <div className="room-notice">{roomNotice}</div>}

        <div className="view-toggle" aria-label="Meeting view">
          <button
            className={viewMode === "speaker" ? "active" : ""}
            type="button"
            onClick={() => setViewMode("speaker")}
          >
            Speaker View
          </button>
          <button
            className={viewMode === "gallery" ? "active" : ""}
            type="button"
            onClick={() => setViewMode("gallery")}
          >
            Gallery View
          </button>
        </div>

        <div className={`meeting-layout ${activeShare ? "sharing" : viewMode}`}>
          {activeShare && <ScreenSharePanel share={activeShare} />}
          <div className={activeShare ? "thumbnail-strip" : "video-grid"}>
            <VideoTile
              label={`${name.trim()} (You)`}
              streamRef={localVideoRef}
              muted
              role={myParticipant?.role || role}
              compact={Boolean(activeShare)}
              featured={!activeShare && viewMode === "speaker"}
            />
            {remoteCameras.map(({ socketId, stream, name: remoteName }) => (
              <RemoteVideoTile
                key={socketId}
                name={remoteName}
                stream={stream}
                role={participants.find((participant) => participant.id === socketId)?.role}
                compact={Boolean(activeShare)}
              />
            ))}
          </div>
        </div>

        <div className="control-bar" aria-label="Meeting controls">
          <button type="button" onClick={toggleMic} title={isMicOn ? "Mute microphone" : "Unmute microphone"}>
            {isMicOn ? <Mic size={22} /> : <MicOff size={22} />}
            <span>{isMicOn ? "Mute" : "Unmute"}</span>
          </button>
          <button type="button" onClick={toggleCamera} title={isCameraOn ? "Turn camera off" : "Turn camera on"}>
            {isCameraOn ? <Camera size={22} /> : <CameraOff size={22} />}
            <span>{isCameraOn ? "Camera" : "Camera Off"}</span>
          </button>
          <button
            type="button"
            onClick={toggleScreenShare}
            disabled={!canShareScreen}
            title={canShareScreen ? "Share screen" : "Screen sharing is not allowed"}
          >
            <MonitorUp size={22} />
            <span>{isSharingScreen ? "Stop Share" : "Share"}</span>
          </button>
          <button className="leave-button" type="button" onClick={leaveMeeting} title="Leave meeting">
            <LogOut size={22} />
            <span>Leave</span>
          </button>
        </div>
      </section>

      <aside className="side-panel">
        <section className="participants-panel">
          <header>
            <h2>Participants</h2>
            {canManageRoom && (
              <button
                className="icon-action"
                type="button"
                onClick={() => setRoomLock(!isLocked)}
                title={isLocked ? "Unlock meeting" : "Lock meeting"}
              >
                {isLocked ? <Lock size={18} /> : <LockOpen size={18} />}
              </button>
            )}
          </header>

          {pendingRequests.length > 0 && canManageRoom && (
            <div className="waiting-list">
              <strong>Waiting room</strong>
              {pendingRequests.map((request) => (
                <div className="waiting-row" key={request.socketId}>
                  <span>{request.name}</span>
                  <button type="button" onClick={() => allowUser(request.socketId)} title="Allow user">
                    <UserCheck size={16} />
                  </button>
                  <button type="button" onClick={() => denyUser(request.socketId)} title="Deny user">
                    <UserMinus size={16} />
                  </button>
                </div>
              ))}
            </div>
          )}

          <div className="participant-list">
            {participants.map((participant) => (
              <ParticipantRow
                key={participant.id}
                participant={participant}
                isSelf={participant.id === mySocketId}
                myRole={role}
                onMute={muteParticipant}
                onRemove={removeParticipant}
                onMakeAdmin={makeAdmin}
                onRemoveAdmin={removeAdmin}
                onSetScreenShare={setScreenSharePermission}
              />
            ))}
          </div>
        </section>

        <section className="chat-panel">
          <header>
            <h2>Chat</h2>
          </header>
          <div className="messages">
            {messages.length === 0 ? (
              <p className="empty-chat">No messages yet.</p>
            ) : (
              messages.map((item) => (
                <article key={item.id} className={item.socketId === socketRef.current?.id ? "own-message" : ""}>
                  <div className="message-meta">
                    <strong>{item.name}</strong>
                    <time>{formatTime(item.timestamp)}</time>
                  </div>
                  <p>{item.message}</p>
                </article>
              ))
            )}
          </div>
          <form className="chat-form" onSubmit={sendMessage}>
            <input
              value={chatInput}
              onChange={(event) => setChatInput(event.target.value)}
              placeholder="Type a message"
              aria-label="Chat message"
            />
            <button type="submit" title="Send message">
              <Send size={18} />
            </button>
          </form>
        </section>
      </aside>
    </main>
  );
}

function ParticipantRow({
  participant,
  isSelf,
  myRole,
  onMute,
  onRemove,
  onMakeAdmin,
  onRemoveAdmin,
  onSetScreenShare
}) {
  const canOrganizerManage = myRole === "organizer" && !isSelf && participant.role !== "organizer";
  const canAdminManage = myRole === "admin" && participant.role === "user" && !isSelf;
  const canManage = canOrganizerManage || canAdminManage;

  return (
    <article className="participant-row">
      <div className="participant-main">
        <span className="participant-name">{participant.name}{isSelf ? " (You)" : ""}</span>
        <span className={`role-badge ${participant.role}`}>
          {participant.role === "organizer" && <Crown size={13} />}
          {participant.role === "admin" && <Shield size={13} />}
          {participant.role}
        </span>
      </div>
      <div className="participant-media">
        {participant.micOn ? <Mic size={15} /> : <MicOff size={15} />}
        {participant.cameraOn ? <Camera size={15} /> : <CameraOff size={15} />}
        <MonitorUp size={15} className={participant.canShareScreen ? "allowed" : "muted-icon"} />
      </div>
      {canManage && (
        <div className="participant-actions">
          <button type="button" onClick={() => onMute(participant.id)} title="Mute participant">
            <MicOff size={15} />
          </button>
          {myRole === "organizer" && participant.role === "user" && (
            <button type="button" onClick={() => onMakeAdmin(participant.id)} title="Make admin">
              <Shield size={15} />
            </button>
          )}
          {myRole === "organizer" && participant.role === "admin" && (
            <button type="button" onClick={() => onRemoveAdmin(participant.id)} title="Remove admin">
              <ShieldMinus size={15} />
            </button>
          )}
          {myRole === "organizer" && participant.role === "user" && (
            <button
              type="button"
              onClick={() => onSetScreenShare(participant.id, !participant.canShareScreen)}
              title={participant.canShareScreen ? "Disable screen sharing" : "Allow screen sharing"}
            >
              <MonitorUp size={15} />
            </button>
          )}
          <button type="button" onClick={() => onRemove(participant.id)} title="Remove participant">
            <UserMinus size={15} />
          </button>
        </div>
      )}
    </article>
  );
}

function ScreenSharePanel({ share }) {
  return (
    <section className="screen-share-panel" aria-label="Screen share">
      <StreamVideo className="screen-share-video" stream={share.stream} muted={share.isLocal} />
      <div className="screen-share-overlay">
        <span className="screen-share-badge">Screen Sharing</span>
        <strong>{share.name}</strong>
      </div>
    </section>
  );
}

function VideoTile({ label, streamRef, muted = false, role, compact = false, featured = false }) {
  return (
    <article className={`video-tile ${compact ? "compact" : ""} ${featured ? "featured" : ""}`}>
      <video ref={streamRef} autoPlay playsInline muted={muted} />
      <span>{label}{role ? ` - ${role}` : ""}</span>
    </article>
  );
}

function StreamVideo({ stream, muted = false, className = "" }) {
  const videoRef = useRef(null);

  useEffect(() => {
    if (videoRef.current) {
      videoRef.current.srcObject = stream;
    }
  }, [stream]);

  return <video className={className} ref={videoRef} autoPlay playsInline muted={muted} />;
}

function RemoteVideoTile({ name, stream, role, compact = false }) {
  const videoRef = useRef(null);

  useEffect(() => {
    if (videoRef.current) {
      videoRef.current.srcObject = stream;
    }
  }, [stream]);

  return <VideoTile label={name} streamRef={videoRef} role={role} compact={compact} />;
}

createRoot(document.getElementById("root")).render(<App />);
