const mongoose = require('mongoose');

const videoSchema = new mongoose.Schema({
  title: { type: String, required: true },
  description: { type: String },
  filename: { type: String, required: true },
  originalName: { type: String, required: true },
  thumbnailPath: { type: String }, // New field for thumbnail
  duration: { type: Number }, // Video duration in seconds
  uploadDate: { type: Date, default: Date.now },
  tags: [String],
  views: { type: Number, default: 0 },
  fileSize: { type: Number }
});

module.exports = mongoose.model('Video', videoSchema);
