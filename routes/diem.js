// routes/diem.js - Quản Lý Điểm API - Cập nhật
const express = require('express');
const router = express.Router();
const db = require('../config/db');
const multer = require('multer');
const XLSX = require('xlsx');

const upload = multer({ storage: multer.memoryStorage() });

// Query lấy dữ liệu Điểm (JOIN với sinh viên, môn học, lớp học)
const SELECT_DIEM_QUERY = `
    SELECT 
        d.id, d.maSV, s.hoTen, d.maMH, m.tenMH, 
        s.maLop, l.tenLop,
        d.diemQT, d.diemThi, d.diemTK,
        d.created_at, d.updated_at
    FROM diem d
    JOIN sinhvien s ON d.maSV = s.maSV
    JOIN monhoc m ON d.maMH = m.maMH
    JOIN lophoc l ON s.maLop = l.maLop
`;

// ========== HELPER FUNCTIONS ==========
function calculateTotalScore(diemQT, diemThi) {
    if (diemQT === null || diemThi === null) return null;
    return parseFloat((diemQT * 0.4 + diemThi * 0.6).toFixed(2));
}

function validateScore(score) {
    if (score === null || score === '') return true;
    const num = parseFloat(score);
    return !isNaN(num) && num >= 0 && num <= 10;
}

// ========== STATISTICS & DASHBOARD ==========
router.get('/stats', async (req, res) => {
    try {
        const [totalSVRows] = await db.execute(
            'SELECT COUNT(DISTINCT maSV) as total FROM diem'
        );
        const totalSV = totalSVRows[0]?.total || 0;

        const [totalMHRows] = await db.execute(
            'SELECT COUNT(DISTINCT maMH) as total FROM diem'
        );
        const totalMH = totalMHRows[0]?.total || 0;

        const [totalDiemRows] = await db.execute(
            'SELECT COUNT(*) as total FROM diem'
        );
        const totalDiem = totalDiemRows[0]?.total || 0;

        const [topScoreRows] = await db.execute(`
            SELECT s.maSV, s.hoTen, ROUND(AVG(d.diemTK), 2) as diemTB
            FROM diem d
            JOIN sinhvien s ON d.maSV = s.maSV
            WHERE d.diemTK IS NOT NULL
            GROUP BY d.maSV, s.hoTen
            ORDER BY diemTB DESC
            LIMIT 1
        `);
        const topScore = topScoreRows[0] || null;

        const [byLopRows] = await db.execute(`
            SELECT l.maLop, l.tenLop, COUNT(d.id) as soDiem, 
                   ROUND(AVG(d.diemTK), 2) as diemTB
            FROM diem d
            JOIN sinhvien s ON d.maSV = s.maSV
            JOIN lophoc l ON s.maLop = l.maLop
            WHERE d.diemTK IS NOT NULL
            GROUP BY l.maLop, l.tenLop
            ORDER BY soDiem DESC
            LIMIT 10
        `);

        const [byMHRows] = await db.execute(`
            SELECT m.maMH, m.tenMH, COUNT(d.id) as soDiem, 
                   ROUND(AVG(d.diemTK), 2) as diemTB
            FROM diem d
            JOIN monhoc m ON d.maMH = m.maMH
            WHERE d.diemTK IS NOT NULL
            GROUP BY m.maMH, m.tenMH
            ORDER BY soDiem DESC
            LIMIT 10
        `);

        res.json({
            totalSV,
            totalMH,
            totalDiem,
            topScore,
            byLop: byLopRows,
            byMH: byMHRows
        });
    } catch (err) {
        console.error('Lỗi stats:', err.message);
        res.status(500).json({ message: 'Lỗi máy chủ' });
    }
});

// ========== DANH SÁCH ĐIỂM - PAGINATION & FILTER ==========
router.get('/', async (req, res) => {
    const { _q: query, page = 1, limit = 100, maLop, maMH, maKhoa } = req.query;

    let whereConditions = [];
    let params = [];

    if (query) {
        whereConditions.push('(s.maSV LIKE ? OR s.hoTen LIKE ? OR m.tenMH LIKE ?)');
        params.push(`%${query}%`, `%${query}%`, `%${query}%`);
    }
    if (maLop) {
        whereConditions.push('l.maLop = ?');
        params.push(maLop);
    }
    if (maMH) {
        whereConditions.push('m.maMH = ?');
        params.push(maMH);
    }
    if (maKhoa) {
        whereConditions.push('l.maKhoa = ?');
        params.push(maKhoa);
    }

    const whereClause = whereConditions.length > 0 ? ' WHERE ' + whereConditions.join(' AND ') : '';

    const sql = SELECT_DIEM_QUERY + whereClause + `
        ORDER BY d.id DESC
        LIMIT ? OFFSET ?
    `;

    const countSql = `
        SELECT COUNT(*) as total FROM diem d
        JOIN sinhvien s ON d.maSV = s.maSV
        JOIN monhoc m ON d.maMH = m.maMH
        JOIN lophoc l ON s.maLop = l.maLop
        ${whereClause}
    `;

    try {
        const [countRows] = await db.execute(countSql, params);
        const total = countRows[0]?.total || 0;

        params.push(parseInt(limit), (parseInt(page) - 1) * parseInt(limit));
        const [rows] = await db.execute(sql, params);

        res.json({
            data: rows,
            total,
            page: parseInt(page),
            limit: parseInt(limit),
            totalPages: Math.ceil(total / limit)
        });
    } catch (err) {
        console.error('Lỗi khi tải danh sách điểm:', err.message);
        res.status(500).json({ message: 'Lỗi máy chủ' });
    }
});

// ========== CHI TIẾT ĐIỂM ==========
router.get('/detail/:diemID', async (req, res) => {
    const { diemID } = req.params;
    try {
        const [rows] = await db.execute(
            SELECT_DIEM_QUERY + ' WHERE d.id = ?',
            [diemID]
        );

        if (rows.length === 0) {
            return res.status(404).json({ message: 'Không tìm thấy điểm' });
        }
        res.json(rows[0]);
    } catch (err) {
        console.error('Lỗi:', err.message);
        res.status(500).json({ message: 'Lỗi máy chủ' });
    }
});

router.post('/', async (req, res) => {
    const { maSV, maMH, diemQT, diemThi, diemID } = req.body;

    console.log('=== BACKEND POST DEBUG ===');
    console.log('Request body:', req.body);
    console.log('diemID:', diemID, 'Type:', typeof diemID);

    if (!maSV || !maMH) {
        return res.status(400).json({ message: 'Thiếu mã sinh viên hoặc mã môn học' });
    }

    const parsedQT = diemQT ? parseFloat(diemQT) : null;
    const parsedThi = diemThi ? parseFloat(diemThi) : null;

    if (!validateScore(parsedQT) || !validateScore(parsedThi)) {
        return res.status(400).json({ message: 'Điểm phải nằm trong khoảng 0-10' });
    }

    const diemTK = calculateTotalScore(parsedQT, parsedThi);

    try {
        // Verify foreign keys
        const [svCheck] = await db.execute('SELECT 1 FROM sinhvien WHERE maSV = ?', [maSV]);
        if (svCheck.length === 0) {
            return res.status(400).json({ message: 'Sinh viên không tồn tại' });
        }

        const [mhCheck] = await db.execute('SELECT 1 FROM monhoc WHERE maMH = ?', [maMH]);
        if (mhCheck.length === 0) {
            return res.status(400).json({ message: 'Môn học không tồn tại' });
        }

        // ✅ Nếu có diemID → UPDATE record cũ
        if (diemID && diemID > 0) {
            console.log('UPDATE mode - diemID:', diemID);
            const [result] = await db.execute(
                'UPDATE diem SET diemQT=?, diemThi=?, diemTK=?, updated_at=NOW() WHERE id=?;',
                [parsedQT, parsedThi, diemTK, diemID]
            );

            console.log('UPDATE result:', result);

            if (result.affectedRows === 0) {
                return res.status(404).json({ message: 'Không tìm thấy điểm để cập nhật' });
            }
            return res.json({ message: 'Cập nhật điểm thành công' });
        }

        // Nếu không có diemID → Thêm mới
        console.log('INSERT/UPSERT mode');
        const [existing] = await db.execute(
            'SELECT id FROM diem WHERE maSV = ? AND maMH = ?',
            [maSV, maMH]
        );

        if (existing.length > 0) {
            console.log('Found existing, UPDATE');
            await db.execute(
                'UPDATE diem SET diemQT = ?, diemThi = ?, diemTK = ?, updated_at = NOW() WHERE maSV = ? AND maMH = ?',
                [parsedQT, parsedThi, diemTK, maSV, maMH]
            );
            return res.json({ message: 'Cập nhật điểm thành công' });
        }

        console.log('No existing, INSERT new');
        await db.execute(
            'INSERT INTO diem (maSV, maMH, diemQT, diemThi, diemTK, created_at, updated_at) VALUES (?, ?, ?, ?, ?, NOW(), NOW())',
            [maSV, maMH, parsedQT, parsedThi, diemTK]
        );
        return res.status(201).json({ message: 'Thêm điểm thành công' });

    } catch (err) {
        console.error('Lỗi:', err.message);
        res.status(500).json({ message: 'Lỗi máy chủ: ' + err.message });
    }
});

// ========== CẬP NHẬT ĐIỂM (theo ID) ==========
router.put('/:diemID', async (req, res) => {
    const { diemID } = req.params;
    const { diemQT, diemThi } = req.body;

    const parsedQT = diemQT !== undefined && diemQT !== '' ? parseFloat(diemQT) : null;
    const parsedThi = diemThi !== undefined && diemThi !== '' ? parseFloat(diemThi) : null;

    console.log('UPDATE mode - so sánh giá trị cũ/mới');
    const [oldRow] = await db.execute('SELECT maSV, maMH FROM diem WHERE id = ?', [diemID]);
    console.log('OLD:', oldRow[0], 'NEW:', { maSV, maMH });


    if (!validateScore(parsedQT) || !validateScore(parsedThi)) {
        return res.status(400).json({ message: 'Điểm phải nằm trong khoảng 0-10' });
    }

    const diemTK = calculateTotalScore(parsedQT, parsedThi);

    try {
        const [result] = await db.execute(
            'UPDATE diem SET diemQT = ?, diemThi = ?, diemTK = ? WHERE id = ?',
            [parsedQT, parsedThi, diemTK, diemID]
        );

        if (result.affectedRows === 0) {
            return res.status(404).json({ message: 'Không tìm thấy điểm' });
        }

        res.json({ message: 'Cập nhật thành công' });
    } catch (err) {
        console.error('Lỗi:', err.message);
        res.status(500).json({ message: 'Lỗi máy chủ' });
    }
});

// ========== XÓA ĐIỂM ==========
router.delete('/:diemID', async (req, res) => {
    const { diemID } = req.params;

    try {
        const [result] = await db.execute('DELETE FROM diem WHERE id = ?', [diemID]);

        if (result.affectedRows === 0) {
            return res.status(404).json({ message: 'Không tìm thấy điểm' });
        }

        res.json({ message: 'Xóa thành công' });
    } catch (err) {
        console.error('Lỗi:', err.message);
        res.status(500).json({ message: 'Lỗi máy chủ' });
    }
});

// ========== XÓA HÀNG LOẠT ==========
router.post('/bulk-delete', async (req, res) => {
    const { ids } = req.body;

    if (!ids || !Array.isArray(ids) || ids.length === 0) {
        return res.status(400).json({ message: 'Danh sách ID không hợp lệ' });
    }

    try {
        const placeholders = ids.map(() => '?').join(',');
        const [result] = await db.execute(
            `DELETE FROM diem WHERE id IN (${placeholders})`,
            ids
        );

        res.json({
            message: `Đã xóa ${result.affectedRows} bản ghi thành công`,
            deletedCount: result.affectedRows
        });
    } catch (err) {
        console.error('Lỗi:', err.message);
        res.status(500).json({ message: 'Lỗi máy chủ' });
    }
});

// ========== IMPORT EXCEL ==========
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

        for (let idx = 0; idx < data.length; idx++) {
            const row = data[idx];
            const maSV = row['Mã SV'] || row['maSV'];
            const maMH = row['Mã MH'] || row['maMH'] || row['Mã Môn']; 
            const diemQT = row['Điểm QT'] || row['diemQT'] || row['Điểm Quá Trình']; 
            const diemThi = row['Điểm Thi'] || row['diemThi'];

            if (!maSV || !maMH) {
                errorRows.push({
                    row: idx + 2,
                    error: 'Thiếu mã sinh viên hoặc mã môn học'
                });
                continue;
            }

            const parsedQT = diemQT ? parseFloat(diemQT) : null;
            const parsedThi = diemThi ? parseFloat(diemThi) : null;

            // ✅ Sửa: Skip nếu cả hai điểm đều rỗng
            if (parsedQT === null && parsedThi === null) {
                errorRows.push({
                    row: idx + 2,
                    error: 'Không có điểm nào (QT và Thi đều rỗng)'
                });
                continue;
            }

            if (!validateScore(parsedQT) || !validateScore(parsedThi)) {
                errorRows.push({
                    row: idx + 2,
                    error: 'Điểm không hợp lệ (0-10)'
                });
                continue;
            }

            try {
                const [svCheck] = await conn.execute(
                    'SELECT 1 FROM sinhvien WHERE maSV = ?',
                    [maSV]
                );
                if (svCheck.length === 0) {
                    errorRows.push({
                        row: idx + 2,
                        error: `Sinh viên '${maSV}' không tồn tại`
                    });
                    continue;
                }

                const [mhCheck] = await conn.execute(
                    'SELECT 1 FROM monhoc WHERE maMH = ?',
                    [maMH]
                );
                if (mhCheck.length === 0) {
                    errorRows.push({
                        row: idx + 2,
                        error: `Môn học '${maMH}' không tồn tại`
                    });
                    continue;
                }

                const diemTK = calculateTotalScore(parsedQT, parsedThi);

                const [existing] = await conn.execute(
                    'SELECT 1 FROM diem WHERE maSV = ? AND maMH = ?',
                    [maSV, maMH]
                );

                if (existing.length > 0) {
                    await conn.execute(
                        'UPDATE diem SET diemQT = ?, diemThi = ?, diemTK = ? WHERE maSV = ? AND maMH = ?',
                        [parsedQT, parsedThi, diemTK, maSV, maMH]
                    );
                } else {
                    await conn.execute(
                        'INSERT INTO diem (maSV, maMH, diemQT, diemThi, diemTK) VALUES (?, ?, ?, ?, ?)',
                        [maSV, maMH, parsedQT, parsedThi, diemTK]
                    );
                }
                successCount++;
            } catch (err) {
                errorRows.push({
                    row: idx + 2,
                    error: err.message
                });
            }
        }

        await conn.release();

        let message = `Import thành công ${successCount}/${data.length} dòng.`;
        if (errorRows.length > 0) {
            const errorsText = errorRows.slice(0, 3)
                .map(e => `Dòng ${e.row}: ${e.error}`)
                .join(' | ');
            message += ` Lỗi: ${errorsText}${errorRows.length > 3 ? '...' : ''}`;
        }

        res.json({ message });
    } catch (err) {
        console.error('Lỗi import:', err.message);
        res.status(500).json({ message: 'Lỗi máy chủ: ' + err.message });
    }
});

// ========== EXPORT EXCEL ==========
router.get('/export', async (req, res) => {
    try {
        const [rows] = await db.execute(SELECT_DIEM_QUERY + ' ORDER BY d.id');

        const wsData = rows.map(row => ({
            'Mã SV': row.maSV,
            'Tên SV': row.hoTen,
            'Lớp': `${row.maLop} - ${row.tenLop}`,
            'Mã MH': row.maMH,
            'Tên MH': row.tenMH,
            'Điểm QT': row.diemQT,
            'Điểm Thi': row.diemThi,
            'Điểm TK': row.diemTK
        }));

        const ws = XLSX.utils.json_to_sheet(wsData);
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, 'DanhSachDiem');

        const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', `attachment; filename=danh_sach_diem_${new Date().toISOString().split('T')[0]}.xlsx`);
        res.send(buffer);
    } catch (err) {
        console.error('Lỗi export:', err.message);
        res.status(500).json({ message: 'Lỗi máy chủ' });
    }
});

// ========== EXPORT ĐÃ CHỌN ==========
router.get('/export-selected', async (req, res) => {
    const { selected } = req.query;
    if (!selected) {
        return res.status(400).json({ message: 'Thiếu danh sách ID đã chọn' });
    }

    const ids = selected.split(',').map(id => parseInt(id));

    try {
        const placeholders = ids.map(() => '?').join(',');
        const [rows] = await db.execute(
            SELECT_DIEM_QUERY + ` WHERE d.id IN (${placeholders})`,
            ids
        );

        const wsData = rows.map(row => ({
            'Mã SV': row.maSV,
            'Tên SV': row.hoTen,
            'Lớp': `${row.maLop} - ${row.tenLop}`,
            'Mã MH': row.maMH,
            'Tên MH': row.tenMH,
            'Điểm QT': row.diemQT,
            'Điểm Thi': row.diemThi,
            'Điểm TK': row.diemTK
        }));

        const ws = XLSX.utils.json_to_sheet(wsData);
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, 'DiemDaChon');

        const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', `attachment; filename=diem_da_chon_${new Date().toISOString().split('T')[0]}.xlsx`);
        res.send(buffer);
    } catch (err) {
        console.error('Lỗi export selected:', err.message);
        res.status(500).json({ message: 'Lỗi máy chủ' });
    }
});

module.exports = router;