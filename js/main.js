'use strict';

// meeting params
const urlParams = new URLSearchParams(window.location.search);
const roomId = urlParams.get('room');
const passive = urlParams.get('passive');

// getUserMedia
const mediaConstraints = {
  audio: {
    channelCount: 2,
    sampleRate: 48000,
    sampleSize: 16
  },
  video: {
    facingMode: 'user',
    frameRate: 15,
    height: 360,
    width: 640
  }
};

// RTCPeerConnection
const turnUser = urlParams.has('turnu') ? urlParams.get('turnu') : '';
const turnPass = urlParams.has('turnp') ? urlParams.get('turnp') : '';
let pcConfig = {};

if (turnUser && turnPass) {
  const turnUrls = [`turns:${window.location.hostname}:5349`];
  pcConfig = {
    iceServers: [ { urls: turnUrls, username: turnUser, credential: turnPass } ],
    iceTransportPolicy: 'all'
  };
};

// setCodecPreferences
const preferredCodecs = {
  audio: RTCRtpReceiver.getCapabilities('audio').codecs.filter(codec =>
    codec.mimeType === 'audio/opus' || codec.mimeType === 'audio/red'
  ),
  video: RTCRtpReceiver.getCapabilities('video').codecs.filter(codec =>
    codec.mimeType === 'video/H264' ||
    codec.mimeType === 'video/red' ||
    codec.mimeType === 'video/rtx' ||
    codec.mimeType === 'video/ulpfec' ||
    codec.mimeType === 'video/flexfec-03'
  )
}

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

// media objects
const localVideo = document.getElementById('localVideo');
const remoteVideo = document.getElementById('remoteVideo');

localVideo.addEventListener('resize', () => {
  console.log(`localVideo >>> size changed to ${localVideo.videoWidth}*${localVideo.videoHeight}`);
});

remoteVideo.addEventListener('resize', () => {
  console.log(`remoteVideo >>> size changed to ${remoteVideo.videoWidth}*${remoteVideo.videoHeight}`);
});

// global variables
let socket;
let localStream;
let remoteStream;
let pc;

// event callbacks
async function start() {
  console.log('startButton >>> user clicked on start');
  startButton.disabled = true;
  try {
    // prepare local stream
    if (!localStream && passive !== 'true') {
      console.log(`startButton >>> Requesting local stream, constraints:\n${JSON.stringify(mediaConstraints, null, 2)}`);
      localStream = await navigator.mediaDevices.getUserMedia(mediaConstraints);
      const streamInfo = { msid: localStream.id, tracks: [] };
      localStream.getTracks().forEach(track => {
        streamInfo.tracks.push({
          id: track.id,
          kind: track.kind,
          label: track.label
        });
      });
      console.log(`startButton >>> Received local stream:\n${JSON.stringify(streamInfo, null, 2)}`);
      localVideo.srcObject = localStream;
    }
    // connect to the socket.io server
    console.log('startButton >>> Connecting to socket.io server...');
    socket = io();
    socket.on('connect', () => {
      console.log(`socket >>> Connected to socket.io server, id=${socket.id}`);
    });
    socket.on('join_notify', onJoinNotify);
    socket.on('leave_notify', onLeaveNotify);
    socket.on('message', onMessage);
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
      console.log(`joinButton >>> Create PeerConnection, configuration:\n${JSON.stringify(pcConfig, null, 2)}`);
      pc = new RTCPeerConnection(pcConfig);
      pc.onconnectionstatechange = () => {
        console.log(`pc >>> Connection state changed to ${pc.connectionState}`);
      };
      pc.onicecandidateerror = (evt) => {
        console.log(`pc >>> ICE candidate error:\n${JSON.stringify(evt, null, 2)}`);
      };
      pc.oniceconnectionstatechange = () => {
        console.log(`pc >>> ICE connection state changed to ${pc.iceConnectionState}`);
      };
      pc.onicegatheringstatechange = () => {
        console.log(`pc >>> ICE gathering state changed to ${pc.iceGatheringState}`);
      };
      pc.onnegotiationneeded = () => {
        console.log('pc >>> Negotiation needed');
      };
      pc.onsignalingstatechange = () => {
        console.log(`pc >>> Signaling state changed to ${pc.signalingState}`);
      };
      pc.addEventListener('icecandidate', onIceCandidate);
      pc.addEventListener('track', onTrack);
      // Add local tracks
      if (localStream) {
        localStream.getTracks().forEach(track => {
          pc.addTrack(track, localStream);
        });
      }
      // Set codec preferences
      pc.getTransceivers().forEach(transceiver => {
        transceiver.setCodecPreferences(preferredCodecs[transceiver.sender.track.kind]);
      });
    }
    // send join request
    console.log(`joinButton >>> Joining room ${roomId}...`);
    const res = await socket.emitWithAck('join', { room: roomId });
    if (!res || res.code !== 200) {
      throw new Error(`Bad response for join: ${JSON.stringify(res)}`);
    }
    console.log(`joinButton >>> joined room ${roomId}, response: ${JSON.stringify(res)}`);
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
  doLeave('leaveButton');
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
    console.log('socket >>> Creating offer...');
    const offer = await pc.createOffer();
    console.log(`socket >>> Offer created:\n${JSON.stringify(offer, null, 2)}`);
    // set local SDP
    console.log('socket >>> Setting local SDP...');
    await pc.setLocalDescription(offer);
    // send offer
    console.log('socket >>> Send offer to peer');
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
  doLeave('socket');
}

async function onMessage(msg) {
  console.log(`socket >>> Received message from server:\n${JSON.stringify(msg, null, 2)}`);
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
      console.log('socket >>> Received offer from peer, setting remote SDP...');
      await pc.setRemoteDescription(new RTCSessionDescription(data));
      console.log('socket >>> Creating answer...');
      const answer = await pc.createAnswer();
      console.log(`socket >>> Answer created:\n${JSON.stringify(answer, null, 2)}`);
      console.log('socket >>> Setting local SDP...');
      await pc.setLocalDescription(answer);
      console.log('socket >>> Send answer to peer');
      socket.emit('message', { room: roomId, data: answer });
    } else if (data.type === 'answer') {
      // caller
      console.log('socket >>> Received answer from peer, setting remote SDP...');
      await pc.setRemoteDescription(new RTCSessionDescription(data));
    } else if (data.type === 'candidate') {
      // both
      console.log('socket >>> Received ICE candidate from peer, adding ICE candidate...');
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
    console.log(`${pattern} >>> leaving room ${roomId}...`);
    const res = await socket.emitWithAck('leave', { room: roomId });
    console.log(`${pattern} >>> left room ${roomId}, response: ${JSON.stringify(res)}`);
  } catch (err) {
    console.error(`${pattern} >>> doLeave() error: ${err}`);
  }
  joinButton.disabled = false;
}

function onIceCandidate(evt) {
  if (evt.candidate !== null) {
    console.log(`pc >>> ICE candidate:\n${JSON.stringify(evt.candidate, null, 2)}`);
    console.log('pc >>> Send ICE candidate to peer');
    socket.emit('message', {
      room: roomId,
      data: {
        type: 'candidate',
        candidate: evt.candidate
      }
    });
  } else {
    console.log('pc >>> ICE candidate: done');
  }
}

function onTrack(evt) {
  const trackInfo = {
    id: evt.track.id,
    kind: evt.track.kind,
    belongsTo: evt.streams.map(stream => stream.id)
  };
  console.log(`pc >>> Got remote track:\n${JSON.stringify(trackInfo, null, 2)}`);
  if (evt.streams.length && (remoteStream !== evt.streams[0])) {
    remoteStream = evt.streams[0];
    remoteVideo.srcObject = remoteStream;
  }
}

// check codecs
if (!preferredCodecs['audio'].length || !preferredCodecs['video'].length) {
  alert('missing codecs');
  throw new Error('missing codecs');
}

// ready to play
startButton.disabled = false;
