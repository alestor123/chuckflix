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
mongoose.connect('mongodb://localhost:27017/pics', { useNewUrlParser: false })
    .then(() => console.log('connect')).catch(err => console.log(err))

// making the collection(table) schema  
// it contains picspath file for saving the file path  
var picSchema = new mongoose.Schema({
        picspath: String
    })
    //collection schema will be saved in DB by name picsdemo   
    // picModel contains the instance of picdemo by which it can manipulate data in it.  
var picModel = mongoose.model('picsdemo', picSchema)


app.set('view engine', 'ejs');

app.set("views", path.resolve(__dirname, 'views'));

var picPath = path.resolve(__dirname, 'public');

app.use(express.static(picPath));