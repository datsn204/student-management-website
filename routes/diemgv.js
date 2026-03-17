const express = require('express');
const router = express.Router();
const db = require('../config/db');

// Helper: Map maTK to maGV
async function getMaGV(maTK) {
    const [gvRows] = await db.execute('SELECT maGV FROM giangvien WHERE maTK = ?', [maTK]);
    if (gvRows.length === 0) {
        throw new Error('Không tìm thấy giảng viên cho mã tài khoản này');
    }
    return gvRows[0].maGV;
}

// Helper: Get maKhoa of GV
async function getMaKhoa(maGV) {
    const [khoaRows] = await db.execute('SELECT maKhoa FROM giangvien WHERE maGV = ?', [maGV]);
    if (khoaRows.length === 0) {
        throw new Error('Không tìm thấy khoa cho giảng viên');
    }
    return khoaRows[0].maKhoa;
}

// API 1: Danh sách Lớp mà giảng viên phụ trách (optional maKhoa filter)
router.get('/lops', async (req, res) => {
    const { maGV: maTK, maKhoa } = req.query;
    if (!maTK) {
        return res.status(400).json({ message: 'Thiếu mã tài khoản (maTK)' });
    }

    let actualMaGV;
    try {
        actualMaGV = await getMaGV(maTK);
    } catch (err) {
        return res.status(400).json({ message: err.message });
    }

    let sql = `
        SELECT DISTINCT lh.maLop, lh.tenLop, k.maKhoa, k.tenKhoa
        FROM lophoc lh
        JOIN lop_mh_gv lmg ON lh.maLop = lmg.maLop
        JOIN khoa k ON lh.maKhoa = k.maKhoa
        WHERE lmg.maGV = ?
    `;
    let params = [actualMaGV];
    if (maKhoa) {
        sql += ' AND k.maKhoa = ?';
        params.push(maKhoa);
    }
    sql += ' ORDER BY lh.maLop';

    try {
        const [rows] = await db.execute(sql, params);
        res.json(rows);
    } catch (err) {
        console.error('Lỗi tải lớp:', err);
        res.status(500).json({ message: 'Lỗi tải lớp: ' + err.message });
    }
});

// API 2: Sinh viên theo Lớp (optional maGV check)
router.get('/sinhviens/:maLop', async (req, res) => {
    const { maLop } = req.params;
    const { maGV: maTK } = req.query;
    let sql = 'SELECT maSV, hoTen, maLop FROM sinhvien WHERE maLop = ? ORDER BY maSV';
    let params = [maLop];
    if (maTK) {
        let actualMaGV;
        try {
            actualMaGV = await getMaGV(maTK);
            sql += ' AND maLop IN (SELECT lmg.maLop FROM lop_mh_gv lmg WHERE lmg.maGV = ?)';
            params.push(actualMaGV);
        } catch (err) {
            return res.status(400).json({ message: err.message });
        }
    }
    try {
        const [rows] = await db.execute(sql, params);
        res.json(rows);
    } catch (err) {
        console.error('Lỗi tải SV:', err);
        res.status(500).json({ message: 'Lỗi tải sinh viên' });
    }
});

// API 3: Môn học theo Lớp (filter by maGV)
router.get('/mon-hoc-by-lop/:maLop', async (req, res) => {
    const { maLop } = req.params;
    const { maGV: maTK } = req.query;
    if (!maTK) {
        return res.status(400).json({ message: 'Thiếu maTK để filter môn của GV' });
    }
    let actualMaGV;
    try {
        actualMaGV = await getMaGV(maTK);
    } catch (err) {
        return res.status(400).json({ message: err.message });
    }
    const sql = `
        SELECT DISTINCT m.maMH, m.tenMH
        FROM monhoc m
        JOIN lop_mh_gv lmg ON m.maMH = lmg.maMH
        WHERE lmg.maLop = ? AND lmg.maGV = ?
        ORDER BY m.maMH
    `;
    try {
        const [rows] = await db.execute(sql, [maLop, actualMaGV]);
        res.json(rows);
    } catch (err) {
        console.error('Lỗi tải môn học:', err);
        res.status(500).json({ message: 'Lỗi tải môn học' });
    }
});

// Mới: API Môn học theo GV (optional maKhoa)
router.get('/mon-hoc-by-gv', async (req, res) => {
    const { maGV: maTK, maKhoa } = req.query;
    if (!maTK) {
        return res.status(400).json({ message: 'Thiếu maTK' });
    }
    let actualMaGV;
    try {
        actualMaGV = await getMaGV(maTK);
    } catch (err) {
        return res.status(400).json({ message: err.message });
    }
    let sql = `
        SELECT DISTINCT m.maMH, m.tenMH
        FROM monhoc m
        JOIN lop_mh_gv lmg ON m.maMH = lmg.maMH
        JOIN lophoc lh ON lmg.maLop = lh.maLop
        WHERE lmg.maGV = ?
    `;
    let params = [actualMaGV];
    if (maKhoa) {
        sql += ' AND lh.maKhoa = ?';
        params.push(maKhoa);
    }
    sql += ' ORDER BY m.maMH';
    try {
        const [rows] = await db.execute(sql, params);
        res.json(rows);
    } catch (err) {
        console.error('Lỗi tải môn học GV:', err);
        res.status(500).json({ message: 'Lỗi tải môn học' });
    }
});

// API 4: Danh sách Điểm (hỗ trợ all với LEFT JOIN, filter maGV, optional maLop, maMH, maKhoa) + PHÂN TRANG
router.get('/', async (req, res) => {
    const { maGV: maTK, maLop, maMH, maKhoa, page = 1, limit = 25, export: isExport } = req.query;
    if (!maTK) {
        return res.status(400).json({ message: 'Thiếu maTK' });
    }
    let actualMaGV;
    try {
        actualMaGV = await getMaGV(maTK);
    } catch (err) {
        return res.status(400).json({ message: err.message });
    }

    let sql = `
        SELECT 
            s.maSV, s.hoTen, s.maLop, l.tenLop,
            m.maMH, m.tenMH,
            d.id, d.diemQT, d.diemThi, d.diemTK
        FROM sinhvien s
        JOIN lophoc l ON s.maLop = l.maLop
        JOIN lop_mh_gv lmg ON l.maLop = lmg.maLop
        JOIN monhoc m ON lmg.maMH = m.maMH
        LEFT JOIN diem d ON d.maSV = s.maSV AND d.maMH = m.maMH
        WHERE lmg.maGV = ?
    `;
    let params = [actualMaGV];
    if (maKhoa) {
        sql += ' AND l.maKhoa = ?';
        params.push(maKhoa);
    }
    if (maLop) {
        sql += ' AND l.maLop = ?';
        params.push(maLop);
    }
    if (maMH) {
        sql += ' AND m.maMH = ?';
        params.push(maMH);
    }
    sql += ' ORDER BY s.maSV, m.maMH';

    try {
        // Nếu export=true, trả về tất cả không phân trang
        if (isExport === 'true') {
            const [rows] = await db.execute(sql, params);
            return res.json(rows);
        }

        // Đếm tổng số bản ghi
        let countSql = `
            SELECT COUNT(*) as total
            FROM (${sql}) as countQuery
        `;
        const [countResult] = await db.execute(countSql, params);
        const total = countResult[0].total;

        // Phân trang
        const pageNum = parseInt(page);
        const limitNum = parseInt(limit);
        const offset = (pageNum - 1) * limitNum;
        const totalPages = Math.ceil(total / limitNum);

        sql += ` LIMIT ? OFFSET ?`;
        params.push(limitNum, offset);

        const [rows] = await db.execute(sql, params);
        
        res.json({
            data: rows,
            total,
            totalPages,
            currentPage: pageNum,
            limit: limitNum
        });
    } catch (err) {
        console.error('Lỗi tải điểm:', err.message);
        res.status(500).json({ message: 'Lỗi tải điểm: ' + err.message });
    }
});

// API 5: Lưu Điểm (Thêm/Sửa) - Cập nhật công thức diemTK
router.post('/save', async (req, res) => {
    const { id: diemID, maSV, maMH, diemQT, diemThi } = req.body;
    if (!maSV || !maMH) return res.status(400).json({ message: 'Thiếu maSV hoặc maMH.' });

    // Validate điểm
    const parsedDiemQT = diemQT !== undefined && diemQT !== null && diemQT !== '' ? parseFloat(diemQT) : null;
    const parsedDiemThi = diemThi !== undefined && diemThi !== null && diemThi !== '' ? parseFloat(diemThi) : null;
    
    if ((parsedDiemQT !== null && (isNaN(parsedDiemQT) || parsedDiemQT < 0 || parsedDiemQT > 10)) ||
        (parsedDiemThi !== null && (isNaN(parsedDiemThi) || parsedDiemThi < 0 || parsedDiemThi > 10))) {
        return res.status(400).json({ message: 'Điểm phải từ 0 đến 10.' });
    }

    // Tính diemTK: 0.4 * QT + 0.6 * Thi nếu cả hai có
    const diemTK = (parsedDiemQT !== null && parsedDiemThi !== null) 
        ? parseFloat((parsedDiemQT * 0.4 + parsedDiemThi * 0.6).toFixed(2)) 
        : null;

    // Kiểm tra maSV và maMH tồn tại
    const [svCheck] = await db.execute('SELECT 1 FROM sinhvien WHERE maSV = ?', [maSV]);
    if (svCheck.length === 0) return res.status(400).json({ message: 'SV không tồn tại.' });
    const [mhCheck] = await db.execute('SELECT 1 FROM monhoc WHERE maMH = ?', [maMH]);
    if (mhCheck.length === 0) return res.status(400).json({ message: 'MH không tồn tại.' });

    let sql, params;
    if (diemID) {
        // Update
        let fields = ['updated_at = NOW()'];
        params = [];
        if (parsedDiemQT !== null) { fields.push('diemQT = ?'); params.push(parsedDiemQT); }
        if (parsedDiemThi !== null) { fields.push('diemThi = ?'); params.push(parsedDiemThi); }
        if (diemTK !== null) { fields.push('diemTK = ?'); params.push(diemTK); }
        sql = `UPDATE diem SET ${fields.join(', ')} WHERE id = ?`;
        params.push(diemID);
    } else {
        // Insert
        sql = 'INSERT INTO diem (maSV, maMH, diemQT, diemThi, diemTK, created_at) VALUES (?, ?, ?, ?, ?, NOW())';
        params = [maSV, maMH, parsedDiemQT, parsedDiemThi, diemTK];
    }
    try {
        await db.execute(sql, params);
        res.json({ message: diemID ? 'Sửa thành công!' : 'Thêm thành công!', diemTK });
    } catch (err) {
        console.error('Lỗi save:', err);
        if (err.code === 'ER_DUP_ENTRY') {
            return res.status(400).json({ message: 'Điểm đã tồn tại cho SV và MH này.' });
        }
        res.status(500).json({ message: 'Lỗi server: ' + err.message });
    }
});

// API 6: Xóa Điểm
router.post('/delete', async (req, res) => {
    const { diemID } = req.body;
    if (!diemID) return res.status(400).json({ message: 'Thiếu ID điểm.' });

    try {
        const [result] = await db.execute('DELETE FROM diem WHERE id = ?', [diemID]);
        if (result.affectedRows === 0) return res.status(404).json({ message: 'Không tìm thấy điểm để xóa.' });
        res.json({ message: 'Xóa thành công!' });
    } catch (err) {
        console.error('Lỗi xóa:', err);
        res.status(500).json({ message: 'Lỗi xóa: ' + err.message });
    }
});

// API 7: Import Điểm từ Excel - Logic đã sửa
router.post('/import', async (req, res) => {
    const { grades, maGV: maTK } = req.body;
    
    if (!grades || !Array.isArray(grades) || grades.length === 0) {
        return res.status(400).json({ message: 'Dữ liệu import không hợp lệ' });
    }

    if (!maTK) {
        return res.status(400).json({ message: 'Thiếu mã tài khoản giảng viên' });
    }

    // Lấy maGV thực tế
    let actualMaGV;
    try {
        actualMaGV = await getMaGV(maTK);
    } catch (err) {
        return res.status(400).json({ message: err.message });
    }

    let success = 0;
    let failed = 0;
    const errors = [];

    for (const grade of grades) {
        try {
            const { maSV, maMH, maLop, diemQT, diemThi } = grade;
            
            if (!maSV || !maMH || !maLop) {
                failed++;
                errors.push(`Thiếu thông tin: maSV=${maSV}, maMH=${maMH}, maLop=${maLop}`);
                continue;
            }

            // ✅ VALIDATE 1: Kiểm tra sinh viên có trong lớp không
            const [svInClass] = await db.execute(
                'SELECT 1 FROM sinhvien WHERE maSV = ? AND maLop = ?',
                [maSV, maLop]
            );
            if (svInClass.length === 0) {
                failed++;
                errors.push(`${maSV}: Không thuộc lớp ${maLop}`);
                continue;
            }

            // ✅ VALIDATE 2: Kiểm tra giảng viên có dạy môn này cho lớp này không
            const [gvTeachesClass] = await db.execute(
                'SELECT 1 FROM lop_mh_gv WHERE maGV = ? AND maLop = ? AND maMH = ?',
                [actualMaGV, maLop, maMH]
            );
            if (gvTeachesClass.length === 0) {
                failed++;
                errors.push(`${maSV}: Bạn không dạy môn ${maMH} cho lớp ${maLop}`);
                continue;
            }

            // ✅ VALIDATE 3: Kiểm tra môn học có tồn tại không
            const [mhCheck] = await db.execute('SELECT 1 FROM monhoc WHERE maMH = ?', [maMH]);
            if (mhCheck.length === 0) {
                failed++;
                errors.push(`${maSV}: Môn học ${maMH} không tồn tại`);
                continue;
            }

            // Parse điểm
            const parsedDiemQT = diemQT !== null && diemQT !== undefined && diemQT !== '' ? parseFloat(diemQT) : null;
            const parsedDiemThi = diemThi !== null && diemThi !== undefined && diemThi !== '' ? parseFloat(diemThi) : null;

            // Validate range
            if ((parsedDiemQT !== null && (isNaN(parsedDiemQT) || parsedDiemQT < 0 || parsedDiemQT > 10)) ||
                (parsedDiemThi !== null && (isNaN(parsedDiemThi) || parsedDiemThi < 0 || parsedDiemThi > 10))) {
                failed++;
                errors.push(`${maSV}: Điểm không hợp lệ (QT=${parsedDiemQT}, Thi=${parsedDiemThi})`);
                continue;
            }

            // Tính điểm TK
            const diemTK = (parsedDiemQT !== null && parsedDiemThi !== null) 
                ? parseFloat((parsedDiemQT * 0.4 + parsedDiemThi * 0.6).toFixed(2)) 
                : null;

            // ✅ Kiểm tra xem điểm đã tồn tại chưa
            const [existingGrade] = await db.execute(
                'SELECT id FROM diem WHERE maSV = ? AND maMH = ?',
                [maSV, maMH]
            );

            if (existingGrade.length > 0) {
                // UPDATE - Chỉ update những trường có giá trị mới
                let fields = ['updated_at = NOW()'];
                let params = [];
                
                if (parsedDiemQT !== null) { 
                    fields.push('diemQT = ?'); 
                    params.push(parsedDiemQT); 
                }
                if (parsedDiemThi !== null) { 
                    fields.push('diemThi = ?'); 
                    params.push(parsedDiemThi); 
                }
                if (diemTK !== null) { 
                    fields.push('diemTK = ?'); 
                    params.push(diemTK); 
                }
                
                params.push(existingGrade[0].id);
                
                await db.execute(
                    `UPDATE diem SET ${fields.join(', ')} WHERE id = ?`,
                    params
                );
            } else {
                // INSERT
                await db.execute(
                    'INSERT INTO diem (maSV, maMH, diemQT, diemThi, diemTK, created_at) VALUES (?, ?, ?, ?, ?, NOW())',
                    [maSV, maMH, parsedDiemQT, parsedDiemThi, diemTK]
                );
            }

            success++;
        } catch (err) {
            failed++;
            errors.push(`${grade.maSV}: ${err.message}`);
            console.error('Lỗi import grade:', err);
        }
    }

    res.json({
        message: 'Import hoàn tất',
        total: grades.length,
        success,
        failed,
        errors: errors.length > 0 ? errors.slice(0, 20) : [] // Trả về tối đa 20 lỗi
    });
});

module.exports = router;