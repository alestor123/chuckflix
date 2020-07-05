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
app.use(bodyParser.urlencoded({ extended: false }))
app.get('/', (req, res) => {
    picModel.find((err, data) => {
        if (err) {
            console.log(err)
        }
        if (data) {
            console.log(data)
            res.render('index', { data: data })
        } else {
            res.render('index', { data: {} })
        }
    })
})

app.post('/', upload.single('pic'), (req, res) => {
    var x = 'uploads/' + req.file.originalname;
    var picss = new picModel({
        picspath: x
    })
    picss.save((err, data) => {
        if (err) {
            console.log(err)
        } else {
            console.log('data', data)
            res.redirect('/')
        }
    })
})

app.get('/download/:id', (req, res) => {
    picModel.find({ _id: req.params.id }, (err, data) => {
        if (err) {
            console.log(err)
        } else {
            var path = __dirname + '/public/' + data[0].picspath;
            res.download(path);
        }
    })
})
const port = process.env.PORT || 80;
app.listen(port, () => console.log(`server running at ${port}`))

module.exports = app;