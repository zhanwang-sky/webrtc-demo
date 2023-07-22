'use strict';

const urlParams = new URLSearchParams(window.location.search);
const roomId = urlParams.get('room');

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
const turnServer = `turn:${window.location.hostname}:3478`;
const turnUser = urlParams.has('turnu') ? urlParams.get('turnu') : '';
const turnPass = urlParams.has('turnp') ? urlParams.get('turnp') : '';
const pcConfig = {
  iceServers: [ { urls: [ turnServer ], username: turnUser, credential: turnPass } ],
  iceTransportPolicy: 'all'
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
  console.log(`Local video size: ${this.videoWidth}*${this.videoHeight}`);
});

remoteVideo.addEventListener('loadedmetadata', function() {
  console.log(`Remote video size: ${this.videoWidth}*${this.videoHeight}`);
});

remoteVideo.addEventListener('resize', () => {
  console.log(`Remote video size changed to ${remoteVideo.videoWidth}*${remoteVideo.videoHeight}`);
});

// event callbacks
let socket;
let localStream;
let pc;

async function start() {
  console.log('user clicked on start');
  startButton.disabled = true;
  try {
    // prepare local stream
    if (!localStream) {
      console.log(`Requesting local stream, constraints=${JSON.stringify(mediaConstraints)}`);
      localStream = await navigator.mediaDevices.getUserMedia(mediaConstraints);
      console.log('Received local stream');
      localVideo.srcObject = localStream;
    }
    // connect to the socket.io server
    console.log('Connecting to socket.io server...');
    socket = io.connect();
    console.log('Connected to socket.io server');
    socket.on('join_notify', onJoinNotify);
    socket.on('leave_notify', onLeaveNotify);
    socket.on('message', onMessage);
    // toggle button state
    joinButton.disabled = false;
  } catch (err) {
    console.error(`start() error: ${err}`);
    // reset buttons
    startButton.disabled = false;
    joinButton.disabled = true;
  }
}

async function join() {
  console.log('user clicked on join');
  joinButton.disabled = true;
  try {
    // create PeerConnection
    if (!pc) {
      console.log(`Creating PeerConnection, configuration=${JSON.stringify(pcConfig)}`);
      pc = new RTCPeerConnection(pcConfig);
      pc.onicecandidate = onIceCandidate;
      pc.oniceconnectionstatechange = onIceStateChange;
      pc.ontrack = gotRemoteStream;
      // Add local tracks
      localStream.getTracks().forEach((track) => pc.addTrack(track, localStream));
      console.log('Added local stream to pc');
    }
    // send join request
    console.log(`Joining room ${roomId}...`);
    const res = await socket.emitWithAck('join', { room: roomId });
    if (!res || res.code !== 200) {
      throw new Error(`Bad response for join: ${JSON.stringify(res)}`);
    }
    console.log(`joined room ${roomId}, response=${JSON.stringify(res)}`);
    // toggle button state
    leaveButton.disabled = false;
  } catch (err) {
    console.error(`join() error: ${err}`);
    // reset buttons
    joinButton.disabled = false;
    leaveButton.disabled = true;
  }
}

async function leave() {
  console.log('user clicked on leave');
  await doLeave();
}

async function onJoinNotify(msg) {
  console.log(`Received join notify from server: ${JSON.stringify(msg)}`);
  // state check
  if (!joinButton.disabled) {
    console.log('we are not in join state, ignore join_notify');
    return;
  }
  // initiate WebRTC call
  try {
    // create offer
    console.log(`caller: create offer, options=${JSON.stringify(offerOptions)}`);
    const offer = await pc.createOffer(offerOptions);
    console.log(`caller: offer created: ${JSON.stringify(offer)}`);
    // set local SDP
    console.log('caller: set local SDP');
    await pc.setLocalDescription(offer);
    // send offer
    console.log('caller: sending offer to peer...');
    socket.emit('message', { room: roomId, data: offer });
  } catch (err) {
    console.error(`Fail to initiate WebRTC call: ${err}`);
  }
}

async function onLeaveNotify(msg) {
  console.log(`Received leave notify from server: ${JSON.stringify(msg)}`);
  // state check
  if (!joinButton.disabled) {
    console.log('we are not in join state, ignore leave_notify');
    return;
  }
  // do leave
  await doLeave();
}

async function onMessage(msg) {
  console.log(`Received message from server: ${JSON.stringify(msg)}`);
  // state check
  if (!joinButton.disabled) {
    console.log('we are not in join state, ignore message');
    return;
  }
  // process message
  try {
    // sanity check
    if (!msg || !msg.room || !msg.data) {
      throw new Error('invalid message');
    }
    let data = msg.data;
    if (data.type === 'offer') {
      // callee
      console.log('callee: received offer from peer, set remote SDP');
      await pc.setRemoteDescription(new RTCSessionDescription(data));
      console.log('callee: create answer, options={}');
      const answer = await pc.createAnswer();
      console.log(`callee: answer created: ${JSON.stringify(answer)}`);
      console.log('callee: set local SDP');
      await pc.setLocalDescription(answer);
      console.log('callee: sending answer to peer...');
      socket.emit('message', { room: roomId, data: answer });
    } else if (data.type === 'answer') {
      // caller
      console.log('caller: received answer from peer, set remote SDP');
      await pc.setRemoteDescription(new RTCSessionDescription(data));
    } else if (data.type === 'candidate') {
      // both
      console.log('both: received ICE candidate from peer, add ICE candidate');
      let candidate = new RTCIceCandidate({
        sdpMLineIndex: data.index,
        candidate: data.candidate
      });
      await pc.addIceCandidate(candidate);
    }
  } catch (err) {
    console.error(`Fail to process message: ${err}`);
  }
}

async function doLeave() {
  leaveButton.disabled = true;
  try {
    // stop remote video
    remoteVideo.srcObject = null;
    // destroy PeerConnection
    pc.close();
    pc = null;
    // send leave request
    const res = await socket.emitWithAck('leave', { room: roomId });
    console.log(`left room ${roomId}, response=${JSON.stringify(res)}`);
  } catch (err) {
    console.error(`doLeave() error: ${err}`);
  }
  joinButton.disabled = false;
}

async function onIceCandidate(evt) {
  console.log(`PeerConnection: ICE candidate: ${JSON.stringify(evt.candidate)}`);
  if (evt.candidate) {
    console.log('PeerConnection: sending ICE candidate to peer...');
    socket.emit('message', {
      room: roomId,
      data: {
        type: 'candidate',
        index: evt.candidate.sdpMLineIndex,
        candidate: evt.candidate.candidate
      }
    });
  }
}

function onIceStateChange(evt) {
  console.log(`PeerConnection: ICE state: ${pc.iceConnectionState}`);
  console.log(`PeerConnection: ICE state change event: ${JSON.stringify(evt)}`);
}

function gotRemoteStream(evt) {
  if (remoteVideo.srcObject !== evt.streams[0]) {
    console.log('PeerConnection: received remote stream');
    remoteVideo.srcObject = evt.streams[0];
  }
}

// ready to play
startButton.disabled = false;

// XXX TODO:
// handle media timeout & socket disconnect
