'use strict';

const roomId = '1209';

const mediaConstraints = {
  audio: false,
  video: {
    width: 640,
    height: 480,
    frameRate: 15,
    // facingMode: 'back',
  }
};

const offerOptions = {
  offerToReceiveAudio: 0,
  offerToReceiveVideo: 1
};

// buttons
const startButton = document.getElementById('startButton');
const joinButton = document.getElementById('joinButton');
const leaveButton = document.getElementById('leaveButton');

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
    // connect to the socket.io server
    if (!socket) {
      console.log('Connecting to socket.io server...');
      socket = io.connect();
      console.log('Connected to socket.io server');
      socket.on('join_notify', onJoinNotify);
      socket.on('leave_notify', onLeaveNotify);
      socket.on('message', onMessage);
    }
    // prepare local stream
    if (!localStream) {
      console.log('Requesting local stream, mediaConstraints:', mediaConstraints);
      localStream = await navigator.mediaDevices.getUserMedia(mediaConstraints);
      console.log('Received local stream');
      localVideo.srcObject = localStream;
    }
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
    // send join request
    console.log(`Joining room ${roomId}...`);
    const res = await socket.emitWithAck('join', roomId);
    const cnt = parseInt(res);
    if (isNaN(cnt) || cnt > 2) {
      throw new Error('Bad response for join:', res);
    }
    console.log(`joined room ${roomId}, usrCnt=${cnt}`);
    // create PeerConnection
    if (!pc) {
      const configuration = {};
      console.log('Creating PeerConnection, configuration:', configuration);
      pc = new RTCPeerConnection(configuration);
      pc.onicecandidate = onIceCandidate;
      pc.oniceconnectionstatechange = onIceStateChange;
      pc.ontrack = gotRemoteStream;
      // Add local tracks
      localStream.getTracks().forEach(track => pc.addTrack(track, localStream));
      console.log('Added local stream to pc');
    }
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
  console.log('Received join notify from server:', msg);
  // state check
  if (!joinButton.disabled) {
    console.log('we are not in join state, ignore join_notify');
    return;
  }
  // initiate WebRTC call
  try {
    // create offer
    console.log('caller: create offer, options:', offerOptions);
    const offer = await pc.createOffer(offerOptions);
    console.log('caller: offer created:', offer);
    // set local SDP
    console.log('caller: set local SDP');
    await pc.setLocalDescription(offer);
    // send offer
    console.log('caller: sending offer to peer...');
    socket.emit('message', roomId, offer);
  } catch (err) {
    console.error(`Fail to initiate WebRTC call: ${err}`);
  }
}

async function onLeaveNotify(msg) {
  console.log('Received leave notify from server:', msg);
  // state check
  if (!joinButton.disabled) {
    console.log('we are not in join state, ignore leave_notify');
    return;
  }
  // do leave
  await doLeave();
}

async function onMessage(msg) {
  console.log('Received message from server:', msg);
  // state check
  if (!joinButton.disabled) {
    console.log('we are not in join state, ignore message');
    return;
  }
  // exchange message
  try {
    // sanity check
    if (!msg) {
      throw new Error('invalid message');
    }
    if (msg.hasOwnProperty('type') && msg.type === 'offer') {
      // callee
      console.log('callee: received offer from peer, set remote SDP');
      await pc.setRemoteDescription(new RTCSessionDescription(msg));
      console.log('callee: create answer');
      const answer = await pc.createAnswer();
      console.log('callee: answer created:', answer);
      console.log('callee: set local SDP');
      await pc.setLocalDescription(answer);
      console.log('callee: sending answer to peer...');
      socket.emit('message', roomId, answer);
    } else if (msg.hasOwnProperty('type') && msg.type === 'answer') {
      // caller
      console.log('caller: received answer from peer, set remote SDP');
      await pc.setRemoteDescription(new RTCSessionDescription(msg));
    } else if (msg.hasOwnProperty('type') && msg.type === 'candidate') {
      // both
      console.log('both: received ICE candidate from peer, add ICE candidate');
      let candidate = new RTCIceCandidate({
        sdpMLineIndex: msg.index,
        candidate: msg.candidate
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
    const res = await socket.emitWithAck('leave', roomId);
    console.log(`left room ${roomId}, res:`, res);
  } catch (err) {
    console.error(`doLeave() error: ${err}`);
  }
  joinButton.disabled = false;
}

async function onIceCandidate(evt) {
  console.log('PeerConnection: ICE candidate:', evt.candidate);
  if (evt.candidate) {
    console.log('PeerConnection: sending ICE candidate to peer...');
    socket.emit('message', roomId, {
      type: 'candidate',
      index: evt.candidate.sdpMLineIndex,
      candidate: evt.candidate.candidate
    });
  }
}

function onIceStateChange(evt) {
  console.log(`PeerConnection: ICE state: ${pc.iceConnectionState}`);
  console.log('PeerConnection: ICE state change event:', evt);
}

function gotRemoteStream(evt) {
  if (remoteVideo.srcObject !== evt.streams[0]) {
    console.log('PeerConnection: received remote stream');
    remoteVideo.srcObject = evt.streams[0];
  }
}
