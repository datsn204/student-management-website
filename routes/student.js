const express = require('express');
const router = express.Router();
const db = require('../config/db');
const multer = require('multer');
const XLSX = require('xlsx');
const upload = multer({ storage: multer.memoryStorage() });

// Query lấy dữ liệu Sinh viên (JOIN với Lớp, Khoa, Tài khoản)
const SELECT_STUDENT_QUERY = `
    SELECT 
        sv.maSV, sv.hoTen, sv.ngaySinh, sv.gioiTinh, sv.email, sv.sdt,
        sv.maLop, lh.tenLop,
        sv.maKhoa, k.tenKhoa,
        sv.maTK, tk.tenDangNhap, tk.trangThai as trangThaiTK,
        COALESCE(sv.trangThai, 'active') as trangThai
    FROM SinhVien sv
    LEFT JOIN LopHoc lh ON sv.maLop = lh.maLop
    LEFT JOIN Khoa k ON sv.maKhoa = k.maKhoa
    LEFT JOIN TaiKhoan tk ON sv.maTK = tk.maTK
`;

// Query thống kê sinh viên
const STATS_STUDENT_QUERY = `
    SELECT 
        COUNT(*) as totalStudents,
        SUM(CASE WHEN trangThai = 'active' THEN 1 ELSE 0 END) as activeStudents,
        SUM(CASE WHEN trangThai = 'graduated' THEN 1 ELSE 0 END) as graduatedStudents,
        SUM(CASE WHEN trangThai = 'suspended' THEN 1 ELSE 0 END) as suspendedStudents
    FROM SinhVien
`;

// ============ GET SINH VIÊN THEO LỚP (Modal Cascade) ============
// GET /api/students/by-lop?maLop=L01
router.get('/by-lop', async (req, res) => {
    const { maLop } = req.query;

    if (!maLop) {
        return res.status(400).json({ message: 'Thiếu maLop' });
    }

    try {
        const [rows] = await db.execute(`
            SELECT maSV, hoTen, maLop, maKhoa
            FROM SinhVien
            WHERE maLop = ? AND trangThai = 'active'
            ORDER BY maSV
        `, [maLop]);

        res.json(rows);
    } catch (err) {
        console.error('Lỗi load SV theo lớp:', err.message);
        res.status(500).json({ message: 'Lỗi máy chủ' });
    }
});

// ============ GET INFO LỚP (lấy maKhoa) ============
// GET /api/students/lop-info/:maLop
router.get('/lop-info/:maLop', async (req, res) => {
    const { maLop } = req.params;

    try {
        const [rows] = await db.execute(`
            SELECT maLop, tenLop, maKhoa
            FROM LopHoc
            WHERE maLop = ?
        `, [maLop]);

        if (rows.length === 0) {
            return res.status(404).json({ message: 'Không tìm thấy lớp' });
        }

        res.json(rows[0]);
    } catch (err) {
        console.error('Lỗi load info lớp:', err.message);
        res.status(500).json({ message: 'Lỗi máy chủ' });
    }
});

// GET /api/students/by-account?maTK=xxx - Lấy thông tin sinh viên theo maTK
router.get('/by-account', async (req, res) => {
    const { maTK } = req.query;

    if (!maTK) {
        return res.status(400).json({ message: 'Thiếu maTK' });
    }

    try {
        const [rows] = await db.execute(`
            SELECT 
                sv.maSV, sv.hoTen, sv.ngaySinh, sv.gioiTinh, 
                sv.email, sv.sdt, sv.maLop, sv.maKhoa, sv.trangThai,
                lh.tenLop, k.tenKhoa,
                tk.tenDangNhap, tk.trangThai as trangThaiTK
            FROM SinhVien sv
            LEFT JOIN LopHoc lh ON sv.maLop = lh.maLop
            LEFT JOIN Khoa k ON sv.maKhoa = k.maKhoa
            LEFT JOIN TaiKhoan tk ON sv.maTK = tk.maTK
            WHERE sv.maTK = ?
        `, [maTK]);

        if (rows.length === 0) {
            return res.status(404).json({ message: 'Không tìm thấy sinh viên với tài khoản này' });
        }

        res.json(rows[0]);
    } catch (err) {
        console.error('Lỗi khi lấy thông tin sinh viên theo maTK:', err.message);
        res.status(500).json({ message: 'Lỗi máy chủ khi lấy thông tin sinh viên' });
    }
});

// ============ DANH SÁCH SINH VIÊN (DANH SÁCH CHÍNH - CÓ FILTER) ============
// GET /api/students: Lấy tất cả hoặc tìm kiếm với pagination và filter
router.get('/', async (req, res) => {
    const { _q: query, page = 1, limit = 100, maKhoa, trangThai, maLop } = req.query;
    let sql = SELECT_STUDENT_QUERY;
    let countSql = `SELECT COUNT(*) as total FROM SinhVien sv 
                    LEFT JOIN LopHoc lh ON sv.maLop = lh.maLop
                    LEFT JOIN Khoa k ON sv.maKhoa = k.maKhoa`;
    let params = [];
    let countParams = [];

    // Xây dựng WHERE clause
    let whereClause = '';
    if (query || maKhoa || trangThai || maLop) {
        whereClause = ' WHERE ';
        let conditions = [];

        if (query) {
            conditions.push('(sv.maSV LIKE ? OR sv.hoTen LIKE ? OR sv.email LIKE ? OR lh.tenLop LIKE ?)');
            params.push(`%${query}%`, `%${query}%`, `%${query}%`, `%${query}%`);
            countParams.push(`%${query}%`, `%${query}%`, `%${query}%`, `%${query}%`);
        }

        if (maKhoa) {
            conditions.push('sv.maKhoa = ?');
            params.push(maKhoa);
            countParams.push(maKhoa);
        }

        if (maLop) {
            conditions.push('sv.maLop = ?');
            params.push(maLop);
            countParams.push(maLop);
        }

        if (trangThai) {
            conditions.push('sv.trangThai = ?');
            params.push(trangThai);
            countParams.push(trangThai);
        }

        whereClause += conditions.join(' AND ');
        sql += whereClause;
        countSql += whereClause;
    }

    sql += ' ORDER BY sv.maSV LIMIT ? OFFSET ?';
    params.push(parseInt(limit), (parseInt(page) - 1) * parseInt(limit));

    try {
        // Lấy total count trước
        const [countRows] = await db.execute(countSql, countParams);
        const total = countRows[0].total;

        // Lấy data
        const [rows] = await db.execute(sql, params);
        res.json({
            data: rows,
            total,
            page: parseInt(page),
            limit: parseInt(limit),
            totalPages: Math.ceil(total / limit)
        });
    } catch (err) {
        console.error('LỖI KHI TẢI DANH SÁCH SINH VIÊN:', err.message, err.sql);
        res.status(500).json({ message: 'Lỗi máy chủ khi tải dữ liệu' });
    }
});

// GET /api/students/stats: Lấy thống kê sinh viên
router.get('/stats', async (req, res) => {
    try {
        const [statsRows] = await db.execute(STATS_STUDENT_QUERY);
        const stats = statsRows[0] || {
            totalStudents: 0,
            activeStudents: 0,
            graduatedStudents: 0,
            suspendedStudents: 0
        };
        res.json(stats);
    } catch (err) {
        console.error('LỖI KHI TẢI THỐNG KÊ:', err.message);
        res.status(500).json({ message: 'Lỗi máy chủ khi tải thống kê' });
    }
});

// GET /api/students/export: Export toàn bộ sinh viên
router.get('/export', async (req, res) => {
    try {
        const [rows] = await db.execute(SELECT_STUDENT_QUERY);

        // Chuyển thành worksheet
        const wsData = rows.map(row => ({
            maSV: row.maSV,
            hoTen: row.hoTen,
            ngaySinh: row.ngaySinh ? row.ngaySinh.toISOString().split('T')[0] : '',
            gioiTinh: row.gioiTinh,
            email: row.email || '',
            sdt: row.sdt || '',
            maLop: row.maLop || '',
            tenLop: row.tenLop || '',
            maKhoa: row.maKhoa || '',
            tenKhoa: row.tenKhoa || '',
            tenDangNhap: row.tenDangNhap || 'Chưa liên kết',
            trangThai: row.trangThai,
            autoCreateAccount: 'no' // mặc định
        }));

        const ws = XLSX.utils.json_to_sheet(wsData);

        // Thống kê theo khoa
        const [khoaStats] = await db.execute(`
            SELECT k.maKhoa, k.tenKhoa, COUNT(sv.maSV) as soLuong
            FROM Khoa k
            LEFT JOIN SinhVien sv ON k.maKhoa = sv.maKhoa
            GROUP BY k.maKhoa, k.tenKhoa
        `);

        const wsKhoaData = khoaStats.map(row => ({
            tenKhoa: row.tenKhoa,
            soLuong: row.soLuong
        }));
        const wsKhoa = XLSX.utils.json_to_sheet(wsKhoaData);

        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, 'DanhSachSinhVien');
        XLSX.utils.book_append_sheet(wb, wsKhoa, 'ThongKeSinhVienTheoKhoa');

        const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });

        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', 'attachment; filename=danh_sach_sinh_vien.xlsx');
        res.send(buffer);
    } catch (err) {
        console.error('LỖI KHI EXPORT SINH VIÊN:', err.message);
        res.status(500).json({ message: 'Lỗi máy chủ khi export dữ liệu' });
    }
});

// GET /api/students/export-selected: Export sinh viên đã chọn
router.get('/export-selected', async (req, res) => {
    const { selected } = req.query;
    if (!selected) {
        return res.status(400).json({ message: 'Thiếu danh sách maSV đã chọn' });
    }

    const maSVs = selected.split(',');
    let sql = `${SELECT_STUDENT_QUERY} WHERE sv.maSV IN (${maSVs.map(() => '?').join(',')})`;

    try {
        const [rows] = await db.execute(sql, maSVs);
        const wsData = rows.map(row => ({
            maSV: row.maSV,
            hoTen: row.hoTen,
            ngaySinh: row.ngaySinh ? row.ngaySinh.toISOString().split('T')[0] : '',
            gioiTinh: row.gioiTinh,
            email: row.email || '',
            sdt: row.sdt || '',
            maLop: row.maLop || '',
            tenLop: row.tenLop || '',
            tenKhoa: row.tenKhoa || '',
            tenDangNhap: row.tenDangNhap || 'Chưa liên kết',
            trangThai: row.trangThai,
            autoCreateAccount: 'no' // mặc định
        }));

        const ws = XLSX.utils.json_to_sheet(wsData);
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, 'Sinh viên đã chọn');
        const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });

        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', `attachment; filename=sinh_vien_da_chon_${new Date().toISOString().split('T')[0]}.xlsx`);
        res.send(buffer);
    } catch (err) {
        console.error('LỖI KHI EXPORT SINH VIÊN ĐÃ CHỌN:', err.message);
        res.status(500).json({ message: 'Lỗi máy chủ khi export dữ liệu' });
    }
});

// POST /api/students: Thêm sinh viên
router.post('/', async (req, res) => {
    const { maSV, hoTen, ngaySinh, gioiTinh, email, sdt, maLop, maKhoa, trangThai, maTK } = req.body;

    if (!maSV || !hoTen || !ngaySinh || !maLop || !maKhoa) {
        return res.status(400).json({ message: 'Thiếu thông tin bắt buộc: Mã SV, Họ Tên, Ngày Sinh, Mã Lớp, hoặc Mã Khoa.' });
    }

    const conn = await db.getConnection();
    try {
        await conn.beginTransaction();

        // Kiểm tra maKhoa tồn tại
        const [existingKhoa] = await conn.execute('SELECT maKhoa FROM Khoa WHERE maKhoa = ?', [maKhoa]);
        if (existingKhoa.length === 0) {
            await conn.rollback();
            return res.status(400).json({ message: 'Mã Khoa không hợp lệ.' });
        }

        // Kiểm tra maLop tồn tại
        const [existingLop] = await conn.execute('SELECT maLop FROM LopHoc WHERE maLop = ?', [maLop]);
        if (existingLop.length === 0) {
            await conn.rollback();
            return res.status(400).json({ message: 'Mã Lớp không hợp lệ.' });
        }

        // Insert sinh viên (bao gồm maTK nếu có)
        const insertFields = ['maSV', 'hoTen', 'ngaySinh', 'gioiTinh', 'email', 'sdt', 'maLop', 'maKhoa', 'trangThai'];
        const insertValues = [maSV, hoTen, ngaySinh, gioiTinh || null, email || null, sdt || null, maLop, maKhoa, trangThai || 'active'];

        if (maTK) {
            insertFields.push('maTK');
            insertValues.push(maTK);
        }

        await conn.execute(
            `INSERT INTO SinhVien (${insertFields.join(', ')}) VALUES (${insertFields.map(() => '?').join(', ')})`,
            insertValues
        );

        await conn.commit();
        res.status(201).json({ message: 'Thêm sinh viên thành công' });
    } catch (err) {
        await conn.rollback();
        if (err.code === 'ER_DUP_ENTRY') return res.status(400).json({ message: 'Mã Sinh viên/Email đã tồn tại!' });
        if (err.code === 'ER_NO_REFERENCED_ROW_2') {
            return res.status(400).json({ message: 'Mã Lớp hoặc Mã Khoa không hợp lệ.' });
        }
        console.error('LỖI KHI THÊM SINH VIÊN:', err.message, err.sql);
        res.status(500).json({ message: 'Lỗi máy chủ khi thêm dữ liệu' });
    } finally {
        conn.release();
    }
});

// POST /api/students/import: Import từ Excel
router.post('/import', upload.single('excelFile'), async (req, res) => {
    if (!req.file) {
        return res.status(400).json({ message: 'Không có file upload!' });
    }

    try {
        const workbook = XLSX.read(req.file.buffer, { type: 'buffer' });
        const sheetName = workbook.SheetNames[0];
        const sheet = workbook.Sheets[sheetName];
        const data = XLSX.utils.sheet_to_json(sheet);

        if (data.length === 0) {
            return res.status(400).json({ message: 'File không có dữ liệu!' });
        }

        const conn = await db.getConnection();
        let successCount = 0;
        let errorRows = [];

        try {
            await conn.beginTransaction();

            for (let row of data) {
                const {
                    maSV,
                    hoTen,
                    ngaySinh,
                    gioiTinh,
                    email,
                    sdt,
                    maLop,
                    maKhoa,
                    trangThai,
                    autoCreateAccount
                } = row;

                // Kiểm tra thiếu dữ liệu
                if (!maSV || !hoTen || !ngaySinh || !maLop || !maKhoa) {
                    errorRows.push({ row, error: 'Thiếu dữ liệu bắt buộc' });
                    continue;
                }

                try {
                    // ✅ 1. Thêm sinh viên + có trạng thái
                    await conn.execute(
                        `INSERT INTO SinhVien (maSV, hoTen, ngaySinh, gioiTinh, email, sdt, maLop, maKhoa, trangThai)
                         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                        [
                            maSV,
                            hoTen,
                            ngaySinh,
                            gioiTinh || null,
                            email || null,
                            sdt || null,
                            maLop,
                            maKhoa,
                            trangThai || 'active'
                        ]
                    );

                    if (autoCreateAccount && autoCreateAccount.toString().toLowerCase() === 'yes') {
                        const maTK = maSV;

                        await conn.execute(
                            `INSERT INTO TaiKhoan (maTK, tenDangNhap, matKhau, vaiTro, trangThai)
         VALUES (?, ?, '123456', 'SinhVien', 'active')`,
                            [maTK, maSV]
                        );

                        await conn.execute(
                            `UPDATE SinhVien SET maTK = ? WHERE maSV = ?`,
                            [maTK, maSV]
                        );
                    }


                    successCount++;
                } catch (err) {
                    errorRows.push({ row, error: err.message });
                }
            }

            await conn.commit();
        } catch (err) {
            await conn.rollback();
            throw err;
        } finally {
            conn.release();
        }

        res.json({
            message: 'Import thành công',
            success: successCount,
            errors: errorRows.length,
            errorDetails: errorRows
        });

    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Có lỗi xảy ra khi import', error });
    }
});


// PUT /api/students/:maSV: Cập nhật sinh viên (SỬA Ở ĐÂY: THÊM maTK VÀO UPDATE)
router.put('/:maSV', async (req, res) => {
    const { maSV } = req.params;
    const { hoTen, ngaySinh, gioiTinh, email, sdt, maLop, maKhoa, trangThai, maTK } = req.body;  // THÊM maTK VÀO DESTRUCTURING

    if (!hoTen || !ngaySinh || !maLop || !maKhoa) {
        return res.status(400).json({ message: 'Thiếu thông tin bắt buộc để cập nhật.' });
    }

    // Kiểm tra nếu maTK có giá trị, thì kiểm tra tồn tại và vai trò (tùy chọn, để an toàn)
    if (maTK) {
        const [existingTK] = await db.execute('SELECT maTK, vaiTro FROM TaiKhoan WHERE maTK = ?', [maTK]);
        if (existingTK.length === 0) {
            return res.status(400).json({ message: `Mã TK '${maTK}' không tồn tại.` });
        }
        if (existingTK[0].vaiTro !== 'SinhVien') {
            return res.status(400).json({ message: `Mã TK '${maTK}' không phải vai trò SinhVien.` });
        }
    }

    const sql = `
        UPDATE SinhVien SET 
            hoTen = ?, 
            ngaySinh = ?, 
            gioiTinh = ?, 
            email = ?, 
            sdt = ?, 
            maLop = ?, 
            maKhoa = ?, 
            trangThai = ?, 
            maTK = ?
        WHERE maSV = ?
    `;

    try {
        const [result] = await db.execute(sql, [
            hoTen,
            ngaySinh,
            gioiTinh || null,
            email || null,
            sdt || null,
            maLop,
            maKhoa,
            trangThai || 'active',
            maTK || null,  // THÊM maTK || null
            maSV
        ]);

        if (result.affectedRows === 0) {
            return res.status(404).json({ message: 'Không tìm thấy sinh viên với mã SV này' });
        }
        res.json({ message: 'Cập nhật sinh viên thành công' });
    } catch (err) {
        if (err.code === 'ER_NO_REFERENCED_ROW_2') {
            return res.status(400).json({ message: 'Mã Lớp, Mã Khoa, hoặc Mã TK không hợp lệ.' });
        }
        console.error('LỖI KHI CẬP NHẬT SINH VIÊN:', err.message, err.sql);
        res.status(500).json({ message: 'Lỗi máy chủ khi cập nhật dữ liệu' });
    }
});

// DELETE /api/students/:maSV: Xóa sinh viên
router.delete('/:maSV', async (req, res) => {
    const { maSV } = req.params;

    try {
        // ✅ Kiểm tra sinh viên tồn tại
        const [checkRows] = await db.execute(
            'SELECT maSV, hoTen FROM SinhVien WHERE maSV = ?', 
            [maSV]
        );
        
        if (checkRows.length === 0) {
            return res.status(404).json({ message: 'Không tìm thấy sinh viên' });
        }

        const student = checkRows[0];

        // ✅ Xóa sinh viên (CASCADE sẽ tự động xóa dữ liệu liên quan)
        await db.execute('DELETE FROM SinhVien WHERE maSV = ?', [maSV]);

        // ✅ CHỈ GỬI 1 response duy nhất
        return res.json({
            message: 'Xóa sinh viên thành công',
            deletedStudent: student
        });

    } catch (err) {
        console.error('❌ LỖI XÓA SINH VIÊN:', err.message, err.code);
        
        if (err.code === 'ER_ROW_IS_REFERENCED_2') {
            return res.status(400).json({
                message: 'Không thể xóa sinh viên này vì đang liên kết với điểm hoặc dữ liệu khác'
            });
        }
        
        // ✅ Trả về lỗi chi tiết
        return res.status(500).json({ 
            message: 'Lỗi máy chủ khi xóa dữ liệu',
            error: err.message 
        });
    }
});

// GET /api/students/:maSV - Lấy thông tin 1 sinh viên để edit
router.get('/:maSV', async (req, res) => {
    const { maSV } = req.params;
    try {
        const [rows] = await db.execute(`
            SELECT 
                sv.maSV, sv.hoTen, sv.ngaySinh, sv.gioiTinh, 
                sv.email, sv.sdt, sv.maLop, sv.maKhoa, sv.trangThai,
                sv.maTK,
                lh.tenLop, k.tenKhoa,
                tk.tenDangNhap
            FROM SinhVien sv
            LEFT JOIN LopHoc lh ON sv.maLop = lh.maLop
            LEFT JOIN Khoa k ON sv.maKhoa = k.maKhoa
            LEFT JOIN TaiKhoan tk ON sv.maTK = tk.maTK
            WHERE sv.maSV = ?
        `, [maSV]);

        if (rows.length === 0) {
            return res.status(404).json({ message: 'Không tìm thấy sinh viên' });
        }

        res.json(rows[0]);
    } catch (err) {
        console.error('Lỗi khi lấy thông tin sinh viên:', err.message);
        res.status(500).json({ message: 'Lỗi máy chủ khi lấy thông tin sinh viên' });
    }
});

// GET /api/students/:maSV/details: Xem chi tiết sinh viên
router.get('/:maSV/details', async (req, res) => {
    const { maSV } = req.params;
    try {
        // Thông tin cơ bản
        const [basicInfo] = await db.execute(`
            SELECT sv.maSV, sv.hoTen, sv.ngaySinh, sv.gioiTinh, sv.email, sv.sdt, 
                   sv.maLop, sv.maKhoa, sv.trangThai,
                   lh.tenLop, k.tenKhoa
            FROM SinhVien sv
            LEFT JOIN LopHoc lh ON sv.maLop = lh.maLop
            LEFT JOIN Khoa k ON sv.maKhoa = k.maKhoa
            WHERE sv.maSV = ?
        `, [maSV]);

        if (basicInfo.length === 0) {
            return res.status(404).json({ message: 'Không tìm thấy sinh viên' });
        }

        const info = basicInfo[0];

        // Danh sách môn học
        const [courses] = await db.execute(`
            SELECT DISTINCT mh.maMH, mh.tenMH, mh.soTinChi, d.diemTK
            FROM diem d
            LEFT JOIN monhoc mh ON d.maMH = mh.maMH
            WHERE d.maSV = ?
            ORDER BY mh.maMH
        `, [maSV]);

        // Thống kê Điểm
        const [statsData] = await db.execute(`
            SELECT 
                COUNT(DISTINCT d.maMH) as soMon,
                AVG(d.diemTK) as diemTB,
                COALESCE(SUM(mh.soTinChi), 0) as tongTinChi
            FROM diem d
            LEFT JOIN monhoc mh ON d.maMH = mh.maMH
            WHERE d.maSV = ? AND d.diemTK IS NOT NULL
        `, [maSV]);

        const stats = statsData[0] || {
            soMon: 0,
            diemTB: null,
            tongTinChi: 0
        };

        res.json({
            info,
            courses: courses || [],
            stats
        });
    } catch (err) {
        console.error('LỖI CHI TIẾT:', err.message, err.sql);
        res.status(500).json({ message: 'Lỗi: ' + err.message });
    }
});

module.exports = router;