'use strict';

// Janus
let janus = null;
let echotest = null;
const echotestPluginBackend = "janus.plugin.echotest";
const echotestOpaqueId = "echotest-" + Janus.randomString(12);

// Buttons
const startButton = document.getElementById('startButton');
const joinButton = document.getElementById('joinButton');
const leaveButton = document.getElementById('leaveButton');

startButton.disabled = true;
joinButton.disabled = true;
leaveButton.disabled = true;

startButton.addEventListener('click', start);
joinButton.addEventListener('click', join);
leaveButton.addEventListener('click', leave);

// Media
const localVideo = document.getElementById('localVideo');
const remoteVideo = document.getElementById('remoteVideo');
let localStream = null;
let remoteStream = null;

const mediaConstraints = {
  audio: true,
  video: {
    width: 320,
    height: 240,
    frameRate: 15,
  }
};

// Callbacks
async function start() {
  Janus.log("startButton >>> User clicked on start");

  startButton.disabled = true;

  try {
    if (!localStream) {
      localStream = await navigator.mediaDevices.getUserMedia(mediaConstraints);
      localVideo.srcObject = localStream;
    }
  } catch (err) {
    Janus.error("startButton >>> Fail to get user media:", err);
    alert("Fail to get user media.");
    window.location.reload();
    return;
  }

  janus = new Janus(
    {
      server: server,
      iceServers: iceServers,
      success: function() {
        Janus.log(`janus >>> Session created, id=${janus.getSessionId()}`);
        joinButton.disabled = false;
      },
      error: function(err) {
        Janus.error("janus >>> Session error:", err);
        // reset buttons
        leaveButton.disabled = true;
        joinButton.disabled = true;
        startButton.disabled = false;
      },
      destroyed: function() {
        Janus.log("janus >>> Session destroyed");
      }
    }
  );
}

async function join() {
  Janus.log("joinButton >>> User clicked on join");

  joinButton.disabled = true;

  janus.attach(
    {
      plugin: echotestPluginBackend,
      opaqueId: echotestOpaqueId,
      success: function(pluginHandle) {
        Janus.log(`janus >>> Plugin attached, id=${pluginHandle.getId()}`);
        remoteStream = new MediaStream();
        remoteVideo.srcObject = remoteStream;
        echotest = pluginHandle;
        echotest.createOffer(
          {
            tracks: [
              { type: 'audio', capture: localStream.getAudioTracks()[0], recv: true, dontStop: true },
              { type: 'video', capture: localStream.getVideoTracks()[0], recv: true, dontStop: true },
            ],
            trickle: true,
            success: function(jsep) {
              Janus.log("echotest >>> Got local SDP:", jsep);
              let body = { audio: true, audiocodec: 'opus', video: true, videocodec: 'h264' };
              echotest.send({ message: body, jsep: jsep });
              leaveButton.disabled = false;
            },
            error: function(err) {
              Janus.error("echotest >>> Error creating offer:", err);
              echotest.detach();
              joinButton.disabled = false;
            }
          }
        );
      },
      error: function(err) {
        Janus.error("janus >>> Plugin error:", err);
        // reset buttons
        leaveButton.disabled = true;
        joinButton.disabled = false;
      },
      webrtcState: function(updown, reason) {
        Janus.log(`janus >>> PeerConnection ${(updown ? "up" : "down")}${reason ? " (" + reason + ")" : ""}`);
      },
      iceState: function(state) {
        Janus.log(`janus >>> ICE state changed to ${state}`);
      },
      mediaState: function(type, receiving, mid) {
        Janus.log(`janus >>> Janus ${receiving ? "started" : "stopped"} receiving ${type}, mid=${mid}`);
      },
      slowLink: function(uplink, lost, mid) {
        Janus.warn(`janus >>> Janus reports problems ${(uplink ? "sending" : "receiving")} packets on mid ${mid} (${lost} pkt lost)`);
      },
      onmessage: function(msg, jsep) {
        Janus.log("janus >>> Got a message:", msg);
        if (jsep) {
          Janus.log("janus >>> Handling remote SDP:", jsep);
          echotest.handleRemoteJsep({ jsep: jsep });
        }
      },
      onremotetrack: function(track, mid, added, metadata) {
        Janus.log(`janus >>> Remote track event, mid=${mid}, ${metadata['reason']}`);
        let reason = metadata['reason'];
        if (reason === 'created') {
          remoteStream.addTrack(track);
        } else if (reason === 'ended') {
          remoteStream.removeTrack(track);
        }
      },
      detached: function() {
        Janus.log("janus >>> Plugin detached");
      }
    }
  );
}

async function leave() {
  Janus.log("joinButton >>> User clicked on leave");

  leaveButton.disabled = true;

  echotest.detach();

  joinButton.disabled = false;
}

// Get ready
$(document).ready(function() {
  // Initialize the library (all console debuggers enabled)
  Janus.init({
    debug: "all",
    callback: function() {
      // ready to play
      Janus.log(`document >>> ready to play, echotestOpaqueId=${echotestOpaqueId}`);
      startButton.disabled = false;
    },
    dependencies: Janus.useDefaultDependencies()
  });
});
