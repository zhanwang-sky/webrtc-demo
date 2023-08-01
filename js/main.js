'use strict';

const urlParams = new URLSearchParams(window.location.search);
const roomId = urlParams.get('room');
const passive = urlParams.get('passive');

// getUserMedia
const mediaConstraints = {
  audio: false,
  video: {
    width: 640,
    height: 480,
    frameRate: 15,
    // facingMode: 'back',
  }
};

// RTCPeerConnection
const turnUser = urlParams.has('turnu') ? urlParams.get('turnu') : '';
const turnPass = urlParams.has('turnp') ? urlParams.get('turnp') : '';
let pcConfig = {};

if (turnUser && turnPass) {
  const turnUrls = [`turn:${window.location.hostname}:3478`];
  pcConfig = {
    iceServers: [ { urls: turnUrls, username: turnUser, credential: turnPass } ],
    iceTransportPolicy: 'all'
  };
};

// Offer
const offerOptions = {
  offerToReceiveAudio: 0,
  offerToReceiveVideo: 1
};

// buttons
const startButton = document.getElementById('startButton');
const joinButton = document.getElementById('joinButton');
const leaveButton = document.getElementById('leaveButton');

startButton.disabled = true;
joinButton.disabled = true;
leaveButton.disabled = true;

startButton.addEventListener('click', start);
joinButton.addEventListener('click', join);
leaveButton.addEventListener('click', leave);

// videos
const localVideo = document.getElementById('localVideo');
const remoteVideo = document.getElementById('remoteVideo');

localVideo.addEventListener('loadedmetadata', function() {
  console.log(`localVideo >>> size: ${this.videoWidth}*${this.videoHeight}`);
});

remoteVideo.addEventListener('loadedmetadata', function() {
  console.log(`remoteVideo >>> size: ${this.videoWidth}*${this.videoHeight}`);
});

remoteVideo.addEventListener('resize', function() {
  console.log(`remoteVideo >>> size changed to ${this.videoWidth}*${this.videoHeight}`);
});

// event callbacks
let socket;
let localStream;
let remoteStream;
let pc;

async function start() {
  console.log('startButton >>> user clicked on start');
  startButton.disabled = true;
  try {
    // prepare local stream
    if (!localStream && passive !== 'true') {
      console.log(`startButton >>> Requesting local stream, constraints=${JSON.stringify(mediaConstraints)}`);
      localStream = await navigator.mediaDevices.getUserMedia(mediaConstraints);
      console.log('startButton >>> Received local stream');
      localVideo.srcObject = localStream;
    }
    // connect to the socket.io server
    console.log('startButton >>> Connecting to socket.io server...');
    socket = io.connect();
    console.log('startButton >>> Connected to socket.io server');
    socket.addEventListener('join_notify', onJoinNotify);
    socket.addEventListener('leave_notify', onLeaveNotify);
    socket.addEventListener('message', onMessage);
    // toggle button state
    joinButton.disabled = false;
  } catch (err) {
    console.error(`startButton >>> start() error: ${err}`);
    // reset buttons
    startButton.disabled = false;
    joinButton.disabled = true;
  }
}

async function join() {
  console.log('joinButton >>> user clicked on join');
  joinButton.disabled = true;
  try {
    // create PeerConnection
    if (!pc) {
      console.log(`joinButton >>> Creating PeerConnection, configuration=${JSON.stringify(pcConfig)}`);
      pc = new RTCPeerConnection(pcConfig);
      pc.onicecandidateerror = (evt) => {
        console.log(`pc >>> ICE candidate error: The server ${evt.url} returned an error with code ${evt.errorCode}: ${evt.errorText}`);
      };
      pc.oniceconnectionstatechange = () => {
        console.log(`pc >>> ICE connection state changed: ${pc.iceConnectionState}`);
      };
      pc.onicegatheringstatechange = () => {
        console.log(`pc >>> ICE gathering state changed: ${pc.iceGatheringState}`);
      };
      pc.onsignalingstatechange = () => {
        console.log(`pc >>> Signaling state changed: ${pc.signalingState}`);
      };
      pc.addEventListener('connectionstatechange', onConnectionStateChange);
      pc.addEventListener('icecandidate', onIceCandidate);
      pc.addEventListener('track', onTrack);
      // Add local tracks
      if (passive !== 'true') {
        localStream.getTracks().forEach((track) => {
          pc.addTrack(track, localStream);
          console.log(`joinButton >>> Added local track to pc: '${track.label}' {${track.id}}`);
        });
      }
    }
    // send join request
    console.log(`joinButton >>> Joining room ${roomId}...`);
    const res = await socket.emitWithAck('join', { room: roomId });
    if (!res || res.code !== 200) {
      throw new Error(`Bad response for join: ${JSON.stringify(res)}`);
    }
    console.log(`joinButton >>> joined room ${roomId}, response=${JSON.stringify(res)}`);
    // toggle button state
    leaveButton.disabled = false;
  } catch (err) {
    console.error(`joinButton >>> join() error: ${err}`);
    // reset buttons
    joinButton.disabled = false;
    leaveButton.disabled = true;
  }
}

async function leave() {
  console.log('leaveButton >>> user clicked on leave');
  await doLeave('leaveButton');
}

async function onJoinNotify(msg) {
  console.log(`socket >>> Received join notify from server: ${JSON.stringify(msg)}`);
  // state check
  if (!joinButton.disabled) {
    console.log('socket >>> we are not in join state, ignore join_notify');
    return;
  }
  // initiate WebRTC call
  try {
    // create offer
    console.log(`socket >>> caller: create offer, options=${JSON.stringify(offerOptions)}`);
    const offer = await pc.createOffer(offerOptions);
    console.log(`socket >>> caller: offer created: ${JSON.stringify(offer)}`);
    // set local SDP
    console.log('socket >>> caller: set local SDP');
    await pc.setLocalDescription(offer);
    // send offer
    console.log('socket >>> caller: sending offer to peer...');
    socket.emit('message', { room: roomId, data: offer });
  } catch (err) {
    console.error(`socket >>> onJoinNotify() error: ${err}`);
  }
}

async function onLeaveNotify(msg) {
  console.log(`socket >>> Received leave notify from server: ${JSON.stringify(msg)}`);
  // state check
  if (!joinButton.disabled) {
    console.log('socket >>> we are not in join state, ignore leave_notify');
    return;
  }
  // do leave
  await doLeave('socket');
}

async function onMessage(msg) {
  console.log(`socket >>> Received message from server: ${JSON.stringify(msg)}`);
  // state check
  if (!joinButton.disabled) {
    console.log('socket >>> we are not in join state, ignore message');
    return;
  }
  // process message
  try {
    // sanity check
    if (!msg || !msg.room || !msg.data) {
      throw new Error('invalid message');
    }
    const data = msg.data;
    if (data.type === 'offer') {
      // callee
      console.log('socket >>> callee: received offer from peer, set remote SDP');
      await pc.setRemoteDescription(new RTCSessionDescription(data));
      console.log('socket >>> callee: create answer, options={}');
      const answer = await pc.createAnswer();
      console.log(`socket >>> callee: answer created: ${JSON.stringify(answer)}`);
      console.log('socket >>> callee: set local SDP');
      await pc.setLocalDescription(answer);
      console.log('socket >>> callee: sending answer to peer...');
      socket.emit('message', { room: roomId, data: answer });
    } else if (data.type === 'answer') {
      // caller
      console.log('socket >>> caller: received answer from peer, set remote SDP');
      await pc.setRemoteDescription(new RTCSessionDescription(data));
    } else if (data.type === 'candidate') {
      // both
      console.log('socket >>> both: received ICE candidate from peer, add ICE candidate');
      await pc.addIceCandidate(new RTCIceCandidate(data.candidate));
    }
  } catch (err) {
    console.error(`socket >>> onMessage() error: ${err}`);
  }
}

async function doLeave(pattern) {
  leaveButton.disabled = true;
  try {
    // stop remote video
    remoteVideo.srcObject = null;
    // destroy PeerConnection
    pc.close();
    pc = null;
    // send leave request
    const res = await socket.emitWithAck('leave', { room: roomId });
    console.log(`${pattern} >>> left room ${roomId}, response=${JSON.stringify(res)}`);
  } catch (err) {
    console.error(`${pattern} >>> doLeave() error: ${err}`);
  }
  joinButton.disabled = false;
}

function onConnectionStateChange() {
  console.log(`pc >>> Conneciton state changed: ${pc.connectionState}`);
  if (pc.connectionState === 'connected') {
    const transceivers = pc.getTransceivers();
    const iceDumper = function(xfer) {
      const track = xfer.track;
      const iceTransport = xfer.transport.iceTransport;
      const pair = iceTransport.getSelectedCandidatePair();
      const localType = `${pair.local.type}`;
      const localCandidate = `${pair.local.address}:${pair.local.port}`;
      const remoteType = `${pair.remote.type}`;
      const remoteCandidate = `${pair.remote.address}:${pair.remote.port}`;
      console.log(`pc >>> ICE pair for track '${track.label}' {${track.id}}: <${localType}>${localCandidate} <=> <${remoteType}>${remoteCandidate}`);
    };
    transceivers.forEach((x) => {
      if (x.sender) {
        iceDumper(x.sender);
      }
      if (x.receiver) {
        iceDumper(x.receiver);
      }
    });
  }
}

function onIceCandidate(evt) {
  console.log(`pc >>> ICE candidate: ${JSON.stringify(evt.candidate)}`);
  if (evt.candidate !== null) {
    console.log('pc >>> sending ICE candidate to peer...');
    socket.emit('message', {
      room: roomId,
      data: {
        type: 'candidate',
        candidate: evt.candidate
      }
    });
  }
}

function onTrack(evt) {
  console.log(`pc >>> Got remote track '${evt.track.label}' {${evt.track.id}}`);
  if (remoteStream !== evt.streams[0]) {
    remoteStream = evt.streams[0];
    remoteVideo.srcObject = remoteStream;
  }
}

// ready to play
startButton.disabled = false;

// XXX TODO:
// handle media timeout & socket disconnect
