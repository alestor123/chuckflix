var express = require('express'),
    bodyParser = require('body-parser'),
    multer = require('multer'),
    mongoose = require('mongoose'),
    path = require('path'),
    app = express(),
    storage = multer.diskStorage({
        destination: function(req, file, cb) {
            cb(null, './public/uploads')
        },
        filename(req, file, cb) {
            cb(null, file.originalname)
        }
    }),
    upload = multer({ storage: storage });