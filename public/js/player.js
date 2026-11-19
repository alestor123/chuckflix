/**
 * Chuckflix Video Player Enhancement
 * - HLS.js initialization for HLS streams
 * - Resume playback from server-side progress
 * - Save progress every 10s to server
 * - Quality switching handler
 * - Speed controls
 * - Error recovery with retry button
 */

(function () {
  'use strict';

  // These globals are set by the watch.ejs template
  var VIDEO_ID = window.CHUCKFLIX_VIDEO_ID || null;
  var HLS_MANIFEST_KEY = window.CHUCKFLIX_HLS_MANIFEST_KEY || null;
  var STREAM_URL = window.CHUCKFLIX_STREAM_URL || null;
  var RENDITIONS = window.CHUCKFLIX_RENDITIONS || [];

  var videoEl = document.getElementById('videoPlayer');
  var hlsInstance = null;
  var progressSaveInterval = null;
  var lastSavedTime = 0;
  var SAVE_INTERVAL_MS = 10000;
  var MIN_SAVE_TIME = 5; // seconds

  if (!videoEl) return;

  // ── Loading overlay ──────────────────────────────────────────────────────────
  var loadingOverlay = document.getElementById('playerLoadingOverlay');

  function showLoading() {
    if (loadingOverlay) loadingOverlay.style.display = 'flex';
  }

  function hideLoading() {
    if (loadingOverlay) loadingOverlay.style.display = 'none';
  }

  videoEl.addEventListener('waiting', showLoading);
  videoEl.addEventListener('playing', hideLoading);
  videoEl.addEventListener('canplay', hideLoading);

  // ── Error overlay ─────────────────────────────────────────────────────────────
  var errorOverlay = document.getElementById('playerErrorOverlay');
  var retryBtn = document.getElementById('playerRetryBtn');

  function showError(msg) {
    if (errorOverlay) {
      var msgEl = errorOverlay.querySelector('.player-error-msg');
      if (msgEl) msgEl.textContent = msg || 'Playback error. Please try again.';
      errorOverlay.style.display = 'flex';
    }
  }

  function hideError() {
    if (errorOverlay) errorOverlay.style.display = 'none';
  }

  if (retryBtn) {
    retryBtn.addEventListener('click', function () {
      hideError();
      initPlayer();
    });
  }

  // ── HLS / Direct init ─────────────────────────────────────────────────────────
  function initPlayer() {
    showLoading();

    if (HLS_MANIFEST_KEY && typeof Hls !== 'undefined' && Hls.isSupported()) {
      // HLS stream via HLS.js
      var hlsUrl = '/viewer/hls/' + HLS_MANIFEST_KEY;
      if (hlsInstance) {
        hlsInstance.destroy();
        hlsInstance = null;
      }
      hlsInstance = new Hls({
        enableWorker: true,
        lowLatencyMode: false,
      });
      hlsInstance.loadSource(hlsUrl);
      hlsInstance.attachMedia(videoEl);

      hlsInstance.on(Hls.Events.MANIFEST_PARSED, function (event, data) {
        populateQualitySelector(data.levels);
        resumePlayback();
      });

      hlsInstance.on(Hls.Events.ERROR, function (event, data) {
        if (data.fatal) {
          switch (data.type) {
            case Hls.ErrorTypes.NETWORK_ERROR:
              hlsInstance.startLoad();
              break;
            case Hls.ErrorTypes.MEDIA_ERROR:
              hlsInstance.recoverMediaError();
              break;
            default:
              showError('Stream error: ' + (data.details || 'unknown'));
              break;
          }
        }
      });
    } else if (HLS_MANIFEST_KEY && videoEl.canPlayType('application/vnd.apple.mpegurl')) {
      // Native HLS (Safari)
      videoEl.src = '/viewer/hls/' + HLS_MANIFEST_KEY;
      videoEl.addEventListener('loadedmetadata', resumePlayback, { once: true });
    } else {
      // Direct MP4 stream
      if (STREAM_URL) {
        videoEl.src = STREAM_URL;
      }
      videoEl.addEventListener('loadedmetadata', resumePlayback, { once: true });
    }

    videoEl.addEventListener('error', function () {
      hideLoading();
      showError('Could not load video. Check your connection and try again.');
    });
  }

  // ── Quality selector ──────────────────────────────────────────────────────────
  var qualitySelect = document.getElementById('qualitySelector');

  function populateQualitySelector(levels) {
    if (!qualitySelect || !levels || levels.length === 0) return;
    qualitySelect.innerHTML = '<option value="-1">Auto</option>';
    levels.forEach(function (level, idx) {
      var label = level.height ? level.height + 'p' : 'Level ' + idx;
      if (level.bitrate) label += ' (' + Math.round(level.bitrate / 1000) + 'k)';
      var opt = document.createElement('option');
      opt.value = idx;
      opt.textContent = label;
      qualitySelect.appendChild(opt);
    });
    qualitySelect.style.display = 'inline-block';
  }

  // Populate from renditions if no HLS
  function populateRenditionSelector() {
    if (!qualitySelect || !RENDITIONS || RENDITIONS.length === 0) return;
    qualitySelect.innerHTML = '<option value="">Auto</option>';
    RENDITIONS.forEach(function (r) {
      var opt = document.createElement('option');
      opt.value = r.s3Key || r.resolution || '';
      opt.textContent = r.resolution || (r.bitrate ? r.bitrate + 'kbps' : 'Unknown');
      qualitySelect.appendChild(opt);
    });
    qualitySelect.style.display = 'inline-block';
  }

  if (qualitySelect) {
    qualitySelect.addEventListener('change', function () {
      var val = parseInt(this.value, 10);
      if (hlsInstance) {
        hlsInstance.currentLevel = isNaN(val) ? -1 : val;
      }
    });
  }

  // ── Speed controls ────────────────────────────────────────────────────────────
  var speedBtns = document.querySelectorAll('.speed-btn');
  speedBtns.forEach(function (btn) {
    btn.addEventListener('click', function () {
      var speed = parseFloat(this.getAttribute('data-speed'));
      if (!isNaN(speed)) {
        videoEl.playbackRate = speed;
        speedBtns.forEach(function (b) { b.classList.remove('active'); });
        this.classList.add('active');
      }
    });
  });

  // ── Resume playback from server ───────────────────────────────────────────────
  function resumePlayback() {
    if (!VIDEO_ID) return;
    fetch('/viewer/progress/' + VIDEO_ID, {
      credentials: 'same-origin',
    })
      .then(function (res) {
        if (!res.ok) return null;
        return res.json();
      })
      .then(function (data) {
        if (data && data.positionSeconds && data.positionSeconds > MIN_SAVE_TIME) {
          videoEl.currentTime = data.positionSeconds;
        } else {
          // Fallback: localStorage
          var saved = localStorage.getItem('chuckflix_progress_' + VIDEO_ID);
          if (saved && parseFloat(saved) > MIN_SAVE_TIME) {
            videoEl.currentTime = parseFloat(saved);
          }
        }
      })
      .catch(function () {
        // Fallback to localStorage
        var saved = localStorage.getItem('chuckflix_progress_' + VIDEO_ID);
        if (saved && parseFloat(saved) > MIN_SAVE_TIME) {
          videoEl.currentTime = parseFloat(saved);
        }
      });
  }

  // ── Save progress every 10s ───────────────────────────────────────────────────
  function saveProgress() {
    if (!VIDEO_ID || !videoEl.duration) return;
    var currentTime = videoEl.currentTime;
    if (currentTime < MIN_SAVE_TIME) return;
    if (Math.abs(currentTime - lastSavedTime) < 1) return; // no meaningful change

    lastSavedTime = currentTime;

    // Save to localStorage as backup
    localStorage.setItem('chuckflix_progress_' + VIDEO_ID, currentTime);

    // Save to server
    fetch('/viewer/progress', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        videoId: VIDEO_ID,
        positionSeconds: Math.floor(currentTime),
        duration: Math.floor(videoEl.duration || 0),
      }),
    }).catch(function () {
      // silent fail — localStorage backup covers it
    });
  }

  videoEl.addEventListener('play', function () {
    if (progressSaveInterval) clearInterval(progressSaveInterval);
    progressSaveInterval = setInterval(saveProgress, SAVE_INTERVAL_MS);
  });

  videoEl.addEventListener('pause', function () {
    saveProgress();
    if (progressSaveInterval) {
      clearInterval(progressSaveInterval);
      progressSaveInterval = null;
    }
  });

  videoEl.addEventListener('ended', function () {
    if (progressSaveInterval) {
      clearInterval(progressSaveInterval);
      progressSaveInterval = null;
    }
    // Clear progress on completion
    localStorage.removeItem('chuckflix_progress_' + VIDEO_ID);
    fetch('/viewer/progress', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        videoId: VIDEO_ID,
        positionSeconds: 0,
        completed: true,
        duration: Math.floor(videoEl.duration || 0),
      }),
    }).catch(function () {});

    // Increment view count
    fetch('/viewer/increment-view/' + VIDEO_ID, {
      method: 'POST',
      credentials: 'same-origin',
    }).catch(function () {});
  });

  // ── Kick off ──────────────────────────────────────────────────────────────────
  if (RENDITIONS && RENDITIONS.length > 0 && !HLS_MANIFEST_KEY) {
    populateRenditionSelector();
  }

  initPlayer();
})();
