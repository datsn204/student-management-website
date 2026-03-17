const express = require('express');
const path = require('path');
const db = require('./config/db');
const accountRoutes = require('./routes/account');
const studentRoutes = require('./routes/student'); 
const authRoutes = require('./routes/auth'); 
const giangvienRoutes = require('./routes/giangvien');
const khoaRoutes = require('./routes/khoa');
const lophocRoutes = require('./routes/lophoc');
const monhocRoutes = require('./routes/monhoc');
const diemRouter = require('./routes/diem');
const diemgvRouter = require('./routes/diemgv');
const lichthiRoutes = require('./routes/lichthi');
const sinhviengvRoutes = require('./routes/sinhviengv');
const phancongRoutes = require('./routes/phancong');
const feedbackRoutes = require('./routes/feedback');


const app = express();
const PORT = process.env.PORT || 3000;

// ============ THÊM CORS ============
app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    
    // Handle preflight
    if (req.method === 'OPTIONS') {
        return res.sendStatus(200);
    }
    
    next();
});

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.static(path.join(__dirname, 'public', 'admin')));

async function testDbConnection() {
    try {
        await db.execute('SELECT 1');
        console.log('✅ Kết nối cơ sở dữ liệu MySQL thành công!');
    } catch (error) {
        console.error('❌ LỖI KẾT NỐI DB. VUI LÒNG KIỂM TRA config/db.js:', error.message);
    }
}
testDbConnection();

app.use('/api/accounts', accountRoutes); 
app.use('/api/students', studentRoutes); 
app.use('/api/auth', authRoutes);
app.use('/api/giangvien', giangvienRoutes); 
app.use('/api/khoas', khoaRoutes);
app.use('/api/lophocs', lophocRoutes);
app.use('/api/monhocs', monhocRoutes);
app.use('/api/diem', diemRouter);
app.use('/api/diemgv', diemgvRouter);
app.use('/api/lichthi', lichthiRoutes);
app.use('/api/sinhviengv', sinhviengvRoutes);
app.use('/api/phancong', phancongRoutes);
app.use('/api/feedback', feedbackRoutes);

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.use((req, res, next) => {
    res.status(404).send("Lỗi 404: Không tìm thấy trang hoặc API endpoint này!");
});

app.listen(PORT, () => {
    console.log(`🚀 Server đang chạy tại http://localhost:${PORT}`);
});