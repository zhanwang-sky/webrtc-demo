'use strict';

const constraints = {
    audio: false,
    video: {
        width: 640,
        height: 480,
        frameRate: 15,
        // facingMode: 'back',
    }
};

function handleSuccess(stream) {
    const video = document.querySelector('video#localVideo');
    const videoTracks = stream.getVideoTracks();
    console.log('Got stream with constraints:', constraints);
    console.log(`Using video device: ${videoTracks[0].label}`);
    video.srcObject = stream;
}

function handleError(error) {
    if (error.name === 'OverconstrainedError') {
        const v = constraints.video;
        console.error(`The resolution ${v.width.exact}x${v.height.exact} px is not supported by your device.`);
    } else if (error.name === 'NotAllowedError') {
        console.error('Permissions have not been granted to use your camera and microphone, '
                      + 'you need to allow the page access to your devices in order for the demo to work.');
    }
    console.error(`getUserMedia error: ${error.name}`, error);
}

async function init(evt) {
    try {
        const stream = await navigator.mediaDevices.getUserMedia(constraints);
        handleSuccess(stream);
        evt.target.disabled = true;
    } catch (err) {
        handleError(err);
    }
}

let socket;

document.querySelector('button#startButton').addEventListener('click', (evt) => {
    if (!socket) {
        socket = io.connect();
        init(evt);
    }
});

document.querySelector('button#callButton').addEventListener('click', () => {
    if (socket) {
        socket.emit('join', '123');
    }
});

document.querySelector('button#hangupButton').addEventListener('click', () => {
    if (socket) {
        socket.emit('leave', '123');
    }
});
