/**
 * Chuckflix Upload Enhancement
 * - Human-readable file size on selection
 * - File size validation before submit
 * - XHR-based upload with progress bar
 * - Success/error response display
 * - Drag-and-drop support
 */

(function () {
  'use strict';

  var MAX_SIZE_BYTES = window.CHUCKFLIX_MAX_UPLOAD_SIZE || 10 * 1024 * 1024 * 1024; // 10 GB default

  var form = document.getElementById('uploadForm');
  var fileInput = document.getElementById('videoInput');
  var fileUploadArea = document.getElementById('fileUploadArea');
  var uploadText = document.getElementById('uploadText');
  var fileInfo = document.getElementById('fileInfo');
  var fileNameEl = document.getElementById('fileName');
  var fileSizeEl = document.getElementById('fileSize');
  var clearButton = document.getElementById('clearFile');
  var submitButton = document.getElementById('uploadSubmitBtn');
  var progressContainer = document.getElementById('uploadProgressContainer');
  var progressBar = document.getElementById('uploadProgressBar');
  var progressPct = document.getElementById('uploadProgressPct');
  var uploadResponse = document.getElementById('uploadResponse');

  if (!fileInput) return;

  // ── Helpers ────────────────────────────────────────────────────────────────────
  function formatBytes(bytes) {
    if (bytes === 0) return '0 B';
    var units = ['B', 'KB', 'MB', 'GB', 'TB'];
    var i = Math.floor(Math.log(bytes) / Math.log(1024));
    return (bytes / Math.pow(1024, i)).toFixed(2) + ' ' + units[i];
  }

  function showMessage(msg, isError) {
    if (!uploadResponse) return;
    uploadResponse.textContent = msg;
    uploadResponse.className = 'upload-response ' + (isError ? 'upload-response--error' : 'upload-response--success');
    uploadResponse.style.display = 'block';
    uploadResponse.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  function resetFileInput() {
    if (fileUploadArea) fileUploadArea.classList.remove('has-file');
    if (uploadText) {
      uploadText.innerHTML = '<strong>Click or drag & drop media file here</strong><br><small>Supported formats: MP4, AVI, MKV, MOV, WebM</small>';
    }
    if (fileInfo) fileInfo.style.display = 'none';
    if (progressContainer) progressContainer.style.display = 'none';
    if (uploadResponse) uploadResponse.style.display = 'none';
    if (submitButton) submitButton.disabled = false;
  }

  // ── File selection handling ───────────────────────────────────────────────────
  function handleFileSelected(file) {
    if (!file) {
      resetFileInput();
      return;
    }

    // Validate size
    if (file.size > MAX_SIZE_BYTES) {
      showMessage('File is too large: ' + formatBytes(file.size) + '. Maximum allowed: ' + formatBytes(MAX_SIZE_BYTES), true);
      fileInput.value = '';
      resetFileInput();
      return;
    }

    if (fileUploadArea) fileUploadArea.classList.add('has-file');
    if (uploadText) {
      uploadText.innerHTML = '<strong>✓ File Selected</strong><br><small>Ready to upload</small>';
    }
    if (fileNameEl) fileNameEl.textContent = file.name;
    if (fileSizeEl) fileSizeEl.textContent = formatBytes(file.size);
    if (fileInfo) fileInfo.style.display = 'flex';
    if (fileInfo) fileInfo.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    if (uploadResponse) uploadResponse.style.display = 'none';
  }

  fileInput.addEventListener('change', function (e) {
    var file = e.target.files && e.target.files[0];
    handleFileSelected(file || null);
  });

  if (clearButton) {
    clearButton.addEventListener('click', function () {
      fileInput.value = '';
      resetFileInput();
    });
  }

  // ── Drag and drop ─────────────────────────────────────────────────────────────
  if (fileUploadArea) {
    fileUploadArea.addEventListener('dragover', function (e) {
      e.preventDefault();
      e.stopPropagation();
      this.classList.add('drag-over');
    });

    fileUploadArea.addEventListener('dragleave', function (e) {
      e.preventDefault();
      e.stopPropagation();
      this.classList.remove('drag-over');
    });

    fileUploadArea.addEventListener('drop', function (e) {
      e.preventDefault();
      e.stopPropagation();
      this.classList.remove('drag-over');

      var dt = e.dataTransfer;
      var files = dt && dt.files;
      if (files && files.length > 0) {
        // Transfer to actual file input
        try {
          var dataTransfer = new DataTransfer();
          dataTransfer.items.add(files[0]);
          fileInput.files = dataTransfer.files;
        } catch (err) {
          // DataTransfer not supported in all browsers - still show info
        }
        handleFileSelected(files[0]);
      }
    });
  }

  // ── XHR upload with progress ──────────────────────────────────────────────────
  if (form) {
    form.addEventListener('submit', function (e) {
      e.preventDefault();

      var file = fileInput.files && fileInput.files[0];
      if (!file) {
        showMessage('Please select a file first.', true);
        return;
      }

      if (file.size > MAX_SIZE_BYTES) {
        showMessage('File is too large: ' + formatBytes(file.size) + '. Maximum: ' + formatBytes(MAX_SIZE_BYTES), true);
        return;
      }

      var formData = new FormData(form);

      // Show progress UI
      if (progressContainer) progressContainer.style.display = 'block';
      if (progressBar) progressBar.style.width = '0%';
      if (progressPct) progressPct.textContent = '0%';
      if (uploadResponse) uploadResponse.style.display = 'none';
      if (submitButton) submitButton.disabled = true;

      var xhr = new XMLHttpRequest();
      xhr.open('POST', form.action || '/admin/upload', true);
      xhr.setRequestHeader('X-Requested-With', 'XMLHttpRequest');

      xhr.upload.addEventListener('progress', function (e) {
        if (e.lengthComputable) {
          var pct = Math.round((e.loaded / e.total) * 100);
          if (progressBar) progressBar.style.width = pct + '%';
          if (progressPct) progressPct.textContent = pct + '%';
        }
      });

      xhr.addEventListener('load', function () {
        if (submitButton) submitButton.disabled = false;
        if (progressBar) progressBar.style.width = '100%';
        if (progressPct) progressPct.textContent = '100%';

        if (xhr.status >= 200 && xhr.status < 400) {
          var data = null;
          try { data = JSON.parse(xhr.responseText); } catch (err) {}

          if (data && data.redirect) {
            window.location.href = data.redirect;
            return;
          }

          var msg = (data && data.message) ? data.message : 'Upload successful! Processing will begin shortly.';
          showMessage(msg, false);

          // Reset form
          form.reset();
          resetFileInput();

          // Reload media list after a moment
          setTimeout(function () { window.location.reload(); }, 2000);
        } else {
          var errData = null;
          try { errData = JSON.parse(xhr.responseText); } catch (err) {}
          var errMsg = (errData && errData.error) ? errData.error : ('Upload failed with status ' + xhr.status);
          showMessage(errMsg, true);
        }
      });

      xhr.addEventListener('error', function () {
        if (submitButton) submitButton.disabled = false;
        showMessage('Network error during upload. Please check your connection.', true);
      });

      xhr.addEventListener('abort', function () {
        if (submitButton) submitButton.disabled = false;
        showMessage('Upload was cancelled.', true);
      });

      xhr.send(formData);
    });
  }
})();
