// routes/giangvien.js - Phiên bản đầy đủ với hash SHA256

const express = require('express');
const router = express.Router();
const db = require('../config/db');
const multer = require('multer');
const XLSX = require('xlsx');
const crypto = require('crypto'); // Import crypto module
const upload = multer({ storage: multer.memoryStorage() });

// ===== HASH PASSWORD FUNCTION =====
function hashPasswordSHA256(password) {
    return crypto.createHash('sha256').update(password).digest('hex');
}

// Query láº¥y dá»¯ liá»‡u Giáº£ng viÃªn (JOIN vá»›i Khoa vÃ  TÃ i khoáº£n)
const SELECT_GIANGVIEN_QUERY = `
    SELECT 
        gv.maGV, gv.hoTen, gv.hocVi, gv.email, gv.sdt, 
        gv.maKhoa, k.tenKhoa,             
        gv.maTK, tk.tenDangNhap
    FROM giangvien gv
    LEFT JOIN khoa k ON gv.maKhoa = k.maKhoa
    LEFT JOIN taikhoan tk ON gv.maTK = tk.maTK
`;

const STATS_GIANGVIEN_QUERY = `
    SELECT k.tenKhoa, COUNT(gv.maGV) as soLuong 
    FROM khoa k 
    LEFT JOIN giangvien gv ON k.maKhoa = gv.maKhoa 
    GROUP BY k.maKhoa, k.tenKhoa
`;

const SELECT_PHANCONG_GV_QUERY = `
    SELECT lmg.id, lmg.maLop, lh.tenLop, lmg.maMH, mh.tenMH, lmg.maGV, lmg.hocKy,
           lg.id as lich_id, lg.thu_tuan, lg.tiet_bat_dau, lg.so_tiet, lg.phong_hoc, lg.ghi_chu
    FROM lop_mh_gv lmg
    JOIN lophoc lh ON lmg.maLop = lh.maLop
    JOIN monhoc mh ON lmg.maMH = mh.maMH
    LEFT JOIN lich_giang_day lg ON lmg.id = lg.id_phan_cong
    WHERE lmg.maGV = ?
    ORDER BY lmg.id, lg.thu_tuan, lg.tiet_bat_dau
`;

const SELECT_SINHVIENGV_INFO_QUERY = `
    SELECT 
        gv.maGV, gv.hoTen, gv.hocVi, gv.email, gv.sdt, 
        gv.maKhoa, k.tenKhoa, tk.tenDangNhap, tk.matKhau
    FROM giangvien gv
    LEFT JOIN khoa k ON gv.maKhoa = k.maKhoa
    LEFT JOIN taikhoan tk ON gv.maTK = tk.maTK
    WHERE gv.maTK = ?
`;

// ===== GET ENDPOINTS =====
router.get('/stats', async (req, res) => {
    try {
        const [totalRows] = await db.execute('SELECT COUNT(*) as total FROM giangvien');
        const totalGiangVien = totalRows[0].total;

        const [lopRows] = await db.execute('SELECT COUNT(DISTINCT maLop) as total FROM lop_mh_gv');
        const totalLop = lopRows[0].total;

        const [activeRows] = await db.execute(`
            SELECT gv.maGV, gv.hoTen, COUNT(lmg.id) as soPhancong
            FROM giangvien gv
            LEFT JOIN lop_mh_gv lmg ON gv.maGV = lmg.maGV
            GROUP BY gv.maGV, gv.hoTen
            ORDER BY soPhancong DESC
            LIMIT 1
        `);
        const mostActive = activeRows[0] || null;

        const [khoaRows] = await db.execute('SELECT COUNT(DISTINCT maKhoa) as total FROM giangvien WHERE maKhoa IS NOT NULL');
        const totalKhoa = khoaRows[0].total;

        const [byKhoaRows] = await db.execute(`
            SELECT k.maKhoa, k.tenKhoa, COUNT(gv.maGV) as soLuong
            FROM khoa k
            LEFT JOIN giangvien gv ON k.maKhoa = gv.maKhoa
            GROUP BY k.maKhoa, k.tenKhoa
            ORDER BY soLuong DESC
        `);

        const [byHocViRows] = await db.execute(`
            SELECT hocVi, COUNT(*) as soLuong
            FROM giangvien
            WHERE hocVi IS NOT NULL
            GROUP BY hocVi
            ORDER BY soLuong DESC
        `);

        res.json({
            totalGiangVien,
            totalLop,
            mostActive,
            totalKhoa,
            byKhoa: byKhoaRows,
            byHocVi: byHocViRows
        });
    } catch (err) {
        console.error('Lỗi stats:', err.message);
        res.status(500).json({ message: 'Lỗi máy chủ' });
    }
});

router.get('/:maGV/details', async (req, res) => {
    const { maGV } = req.params;
    try {
        const [gvRows] = await db.execute(`
            SELECT 
                gv.maGV, 
                gv.hoTen, 
                gv.hocVi, 
                gv.email, 
                gv.sdt,
                gv.maKhoa, 
                k.tenKhoa,
                COUNT(DISTINCT lmg.id) as soPhancong
            FROM giangvien gv
            LEFT JOIN khoa k ON gv.maKhoa = k.maKhoa
            LEFT JOIN lop_mh_gv lmg ON gv.maGV = lmg.maGV
            WHERE gv.maGV = ?
            GROUP BY gv.maGV, gv.hoTen, gv.hocVi, gv.email, gv.sdt, gv.maKhoa, k.tenKhoa
        `, [maGV]);

        if (gvRows.length === 0) {
            return res.status(404).json({ message: 'Không tìm thấy giảng viên' });
        }

        const gvDetail = gvRows[0];

        const [phancongRows] = await db.execute(`
            SELECT DISTINCT
                lmg.id,
                lmg.maLop,
                lh.tenLop,
                lmg.maMH,
                mh.tenMH,
                lmg.hocKy
            FROM lop_mh_gv lmg
            JOIN lophoc lh ON lmg.maLop = lh.maLop
            JOIN monhoc mh ON lmg.maMH = mh.maMH
            WHERE lmg.maGV = ?
            ORDER BY lmg.maLop, lmg.maMH
        `, [maGV]);

        const phancongWithLich = [];
        for (const pc of phancongRows) {
            const [lichRows] = await db.execute(`
                SELECT 
                    id,
                    thu_tuan,
                    tiet_bat_dau,
                    so_tiet,
                    phong_hoc,
                    ghi_chu
                FROM lich_giang_day
                WHERE id_phan_cong = ?
                ORDER BY thu_tuan, tiet_bat_dau
            `, [pc.id]);

            phancongWithLich.push({
                ...pc,
                lich: lichRows
            });
        }

        res.json({
            gvDetail,
            phancong: phancongWithLich
        });

    } catch (err) {
        console.error('Lỗi chi tiết GV:', err.message);
        res.status(500).json({ message: 'Lỗi máy chủ khi tải chi tiết' });
    }
});

router.get('/', async (req, res) => {
    const { _q: query, page = 1, limit = 10, maKhoa, hocVi } = req.query;
    let sql = SELECT_GIANGVIEN_QUERY;
    let countSql = `SELECT COUNT(*) as total FROM giangvien gv LEFT JOIN khoa k ON gv.maKhoa = k.maKhoa LEFT JOIN taikhoan tk ON gv.maTK = tk.maTK`;
    let params = [];
    let countParams = [];

    let whereClause = '';
    if (query || maKhoa || hocVi) {
        whereClause = ' WHERE ';
        let conditions = [];

        if (query) {
            conditions.push('gv.maGV LIKE ? OR gv.hoTen LIKE ? OR k.tenKhoa LIKE ? OR gv.sdt LIKE ?');
            params.push(`%${query}%`, `%${query}%`, `%${query}%`, `%${query}%`);
            countParams.push(`%${query}%`, `%${query}%`, `%${query}%`, `%${query}%`);
        }

        if (maKhoa) {
            conditions.push('gv.maKhoa = ?');
            params.push(maKhoa);
            countParams.push(maKhoa);
        }

        if (hocVi) {
            conditions.push('gv.hocVi = ?');
            params.push(hocVi);
            countParams.push(hocVi);
        }

        whereClause += conditions.join(' AND ');
        sql += whereClause;
        countSql += whereClause;
    }

    sql += ' ORDER BY gv.maGV LIMIT ? OFFSET ?';
    params.push(parseInt(limit), (parseInt(page) - 1) * parseInt(limit));

    try {
        const [countRows] = await db.execute(countSql, countParams);
        const total = countRows[0].total;

        const [rows] = await db.execute(sql, params);
        res.json({
            data: rows,
            total,
            page: parseInt(page),
            limit: parseInt(limit),
            totalPages: Math.ceil(total / limit)
        });
    } catch (err) {
        console.error('Lỗi danh sách GV:', err.message);
        res.status(500).json({ message: 'Lỗi máy chủ khi tải dữ liệu' });
    }
});

router.get('/:maGV/phancong', async (req, res) => {
    const { maGV } = req.params;
    try {
        const [rows] = await db.execute(SELECT_PHANCONG_GV_QUERY, [maGV]);
        const grouped = rows.reduce((acc, row) => {
            const key = row.id;
            if (!acc[key]) {
                acc[key] = { ...row, lich: [] };
                delete acc[key].lich_id;
                delete acc[key].thu_tuan;
                delete acc[key].tiet_bat_dau;
                delete acc[key].so_tiet;
                delete acc[key].phong_hoc;
                delete acc[key].ghi_chu;
            }
            if (row.lich_id) {
                acc[key].lich.push({
                    lich_id: row.lich_id,
                    thu_tuan: row.thu_tuan,
                    tiet_bat_dau: row.tiet_bat_dau,
                    so_tiet: row.so_tiet,
                    phong_hoc: row.phong_hoc,
                    ghi_chu: row.ghi_chu
                });
            }
            return acc;
        }, {});
        res.json(Object.values(grouped));
    } catch (err) {
        console.error('Lỗi phân công GV:', err.message);
        res.status(500).json({ message: 'Lỗi máy chủ khi tải phân công' });
    }
});

router.get('/info', async (req, res) => {
    const { maTK } = req.query;
    if (!maTK) {
        return res.status(400).json({ message: 'Thiếu mã tài khoản (maTK)' });
    }

    try {
        const [rows] = await db.execute(SELECT_SINHVIENGV_INFO_QUERY, [maTK]);
        if (rows.length === 0) {
            return res.status(404).json({ message: 'Không tìm thấy giảng viên với mã tài khoản này' });
        }
        res.json(rows[0]);
    } catch (err) {
        console.error('Lỗi info GV:', err.message);
        res.status(500).json({ message: 'Lỗi máy chủ khi tải thông tin' });
    }
});

router.get('/check-unique', async (req, res) => {
    const { field, value } = req.query;
    if (!field || !value) return res.status(400).json({ available: false });
    try {
        let sql = field === 'maGV' ? 'SELECT maGV FROM giangvien WHERE maGV = ?' : 'SELECT email FROM giangvien WHERE email = ?';
        const [rows] = await db.execute(sql, [value]);
        res.json({ available: rows.length === 0 });
    } catch (err) {
        res.status(500).json({ available: false });
    }
});

router.get('/export', async (req, res) => {
    try {
        const [rows] = await db.execute(SELECT_GIANGVIEN_QUERY);
        
        const wsData = rows.map(row => ({
            maGV: row.maGV,
            hoTen: row.hoTen,
            hocVi: row.hocVi,
            email: row.email || '',
            sdt: row.sdt || '',
            maKhoa: row.maKhoa,
            tenKhoa: row.tenKhoa || '',
            maTK: row.maTK || '',
            tenDangNhap: row.tenDangNhap || ''
        }));
        
        const ws = XLSX.utils.json_to_sheet(wsData);
        const [statsRows] = await db.execute(STATS_GIANGVIEN_QUERY);
        const wsStats = XLSX.utils.json_to_sheet(statsRows);
        
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, 'Danh sách');
        XLSX.utils.book_append_sheet(wb, wsStats, 'Thống kê');
        
        const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
        
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', 'attachment; filename=danh_sach_giang_vien.xlsx');
        res.send(buffer);
        
    } catch (err) {
        console.error('Lỗi export:', err.message);
        res.status(500).json({ message: 'Lỗi máy chủ khi export' });
    }
});

router.get('/export-selected', async (req, res) => {
    const { selected } = req.query;
    if (!selected) {
        return res.status(400).json({ message: 'Thiếu danh sách maGV' });
    }

    const maGVs = selected.split(',');
    let sql = `
        SELECT 
            gv.maGV, gv.hoTen, gv.hocVi, gv.email, gv.sdt, 
            gv.maKhoa, k.tenKhoa, tk.tenDangNhap
        FROM giangvien gv
        LEFT JOIN khoa k ON gv.maKhoa = k.maKhoa
        LEFT JOIN taikhoan tk ON gv.maTK = tk.maTK
        WHERE gv.maGV IN (${maGVs.map(() => '?').join(',')})
    `;

    try {
        const [rows] = await db.execute(sql, maGVs);
        const ws = XLSX.utils.json_to_sheet(rows);
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, 'Giảng viên đã chọn');
        const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });

        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', `attachment; filename=giang_vien_${new Date().toISOString().split('T')[0]}.xlsx`);
        res.send(buffer);
    } catch (err) {
        console.error('Lỗi export selected:', err.message);
        res.status(500).json({ message: 'Lỗi máy chủ' });
    }
});

// routes/giangvien.js - Phần POST /api/giangvien

router.post('/', async (req, res) => {
    const { maGV, hoTen, hocVi, email, sdt, maKhoa, maTK, autoCreateAccount } = req.body;
    
    if (!maGV || !hoTen || !hocVi || !maKhoa) { 
        return res.status(400).json({ message: 'Thiếu thông tin bắt buộc' });
    }
    
    const conn = await db.getConnection();
    try {
        await conn.beginTransaction();
        
        let finalMaTK = maTK || null;
        
        // Kiểm tra autoCreateAccount là boolean hoặc string
        const shouldAutoCreate = autoCreateAccount === true || 
                               autoCreateAccount === 'true' || 
                               autoCreateAccount === 'Yes' || 
                               autoCreateAccount === 'Có';
        
        console.log('Creating giangvien:', {maGV, hoTen, shouldAutoCreate});
        
        if (shouldAutoCreate) {
            const newMaTK = maGV;
            const tenDangNhap = maGV;
            const plainPassword = '123456';
            const matKhau = hashPasswordSHA256(plainPassword); // HASH SHA256
            const vaiTro = 'GiangVien';
            
            // Kiểm tra duplicate tenDangNhap
            const [existingDN] = await conn.execute(
                'SELECT maTK FROM taikhoan WHERE tenDangNhap = ?', 
                [tenDangNhap]
            );
            
            if (existingDN.length === 0) {
                // Tên đăng nhập chưa tồn tại, tạo mới
                try {
                    await conn.execute(
                        `INSERT INTO taikhoan (maTK, tenDangNhap, matKhau, vaiTro) VALUES (?, ?, ?, ?)`,
                        [newMaTK, tenDangNhap, matKhau, vaiTro]
                    );
                    console.log('Account created:', newMaTK);
                } catch (tkErr) {
                    // Nếu lỗi duplicate, bỏ qua (vì frontend đã tạo rồi)
                    if (tkErr.code === 'ER_DUP_ENTRY') {
                        console.log('Account already exists (from frontend):', newMaTK);
                    } else {
                        throw tkErr;
                    }
                }
            } else {
                // Tên đăng nhập đã tồn tại, bỏ qua
                console.log('Username already exists:', tenDangNhap);
            }
            
            finalMaTK = newMaTK;
        }
        
        // Kiểm tra maKhoa tồn tại
        const [existingKhoa] = await conn.execute('SELECT maKhoa FROM khoa WHERE maKhoa = ?', [maKhoa]);
        if (existingKhoa.length === 0) {
            await conn.rollback();
            return res.status(400).json({ message: 'Mã Khoa không hợp lệ.' });
        }
        
        // Kiểm tra maTK tồn tại (nếu cung cấp)
        if (finalMaTK) {
            const [existingTK] = await conn.execute(
                'SELECT maTK FROM taikhoan WHERE maTK = ? AND vaiTro = "GiangVien"', 
                [finalMaTK]
            );
            if (existingTK.length === 0) {
                await conn.rollback();
                return res.status(400).json({ message: `Mã TK '${finalMaTK}' không hợp lệ.` });
            }
        }
        
        // Kiểm tra email trùng
        if (email) {
            const [existingEmail] = await conn.execute('SELECT maGV FROM giangvien WHERE email = ?', [email]);
            if (existingEmail.length > 0) {
                await conn.rollback();
                return res.status(400).json({ message: `Email '${email}' đã tồn tại.` });
            }
        }
        
        // Insert giảng viên
        await conn.execute(
            `INSERT INTO giangvien (maGV, hoTen, hocVi, email, sdt, maKhoa, maTK) 
             VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [maGV, hoTen, hocVi, email || null, sdt || null, maKhoa, finalMaTK]
        );
        
        await conn.commit();
        res.status(201).json({ 
            message: 'Thêm giảng viên thành công' + (shouldAutoCreate ? ' (và tạo tài khoản tự động)' : '') 
        });
        
    } catch (err) {
        await conn.rollback();
        
        if (err.code === 'ER_DUP_ENTRY') {
            return res.status(400).json({ message: 'Mã GV/Email đã tồn tại!' });
        }
        if (err.code === 'ER_NO_REFERENCED_ROW_2') {
            return res.status(400).json({ message: 'Mã Khoa hoặc Mã Tài khoản không hợp lệ.' });
        }
        
        console.error('Lỗi thêm giảng viên:', err.message, err.sql);
        res.status(500).json({ message: 'Lỗi máy chủ: ' + err.message });
    } finally {
        conn.release();
    }
});

router.post('/import', upload.single('excelFile'), async (req, res) => {
    if (!req.file) {
        return res.status(400).json({ message: 'Không có file upload' });
    }
    
    try {
        const workbook = XLSX.read(req.file.buffer, { type: 'buffer' });
        const sheet = workbook.Sheets[workbook.SheetNames[0]];
        const data = XLSX.utils.sheet_to_json(sheet);
        
        if (data.length === 0) {
            return res.status(400).json({ message: 'File không có dữ liệu' });
        }
        
        const conn = await db.getConnection();
        let successCount = 0;
        let errorRows = [];
        
        for (let row of data) {
            const { maGV, hoTen, hocVi, email, sdt, maKhoa, maTK, autoCreateAccount } = row;
            const shouldAutoCreate = autoCreateAccount === true || autoCreateAccount === 'Yes' || autoCreateAccount === 'Có' || autoCreateAccount === 1;
            
            if (!maGV || !hoTen || !hocVi || !maKhoa) {
                errorRows.push({ row: row.__rowNum__ + 1, error: 'Thiếu thông tin bắt buộc' });
                continue;
            }
            
            const [existingGV] = await conn.execute('SELECT maGV FROM giangvien WHERE maGV = ?', [maGV]);
            if (existingGV.length > 0) {
                errorRows.push({ row: row.__rowNum__ + 1, error: `Mã GV '${maGV}' đã tồn tại` });
                continue;
            }
            
            if (email) {
                const [existingEmail] = await conn.execute('SELECT maGV FROM giangvien WHERE email = ?', [email]);
                if (existingEmail.length > 0) {
                    errorRows.push({ row: row.__rowNum__ + 1, error: `Email '${email}' đã tồn tại` });
                    continue;
                }
            }
            
            const [existingKhoa] = await conn.execute('SELECT maKhoa FROM khoa WHERE maKhoa = ?', [maKhoa]);
            if (existingKhoa.length === 0) {
                errorRows.push({ row: row.__rowNum__ + 1, error: `Mã Khoa '${maKhoa}' không tồn tại` });
                continue;
            }
            
            let finalMaTK = maTK || null;
            
            if (shouldAutoCreate) {
                const newMaTK = maGV;
                const tenDangNhap = maGV;
                const plainPassword = '123456';
                const matKhau = hashPasswordSHA256(plainPassword); // HASH SHA256
                const vaiTro = 'GiangVien';
                
                const [existingDN] = await conn.execute('SELECT maTK FROM taikhoan WHERE tenDangNhap = ?', [tenDangNhap]);
                if (existingDN.length > 0) {
                    errorRows.push({ row: row.__rowNum__ + 1, error: 'Tên đăng nhập đã tồn tại' });
                    continue;
                }
                
                try {
                    await conn.execute(
                        `INSERT INTO taikhoan (maTK, tenDangNhap, matKhau, vaiTro) VALUES (?, ?, ?, ?)`,
                        [newMaTK, tenDangNhap, matKhau, vaiTro]
                    );
                    finalMaTK = newMaTK;
                } catch (tkErr) {
                    errorRows.push({ row: row.__rowNum__ + 1, error: `Lỗi tạo tài khoản` });
                    continue;
                }
            } else if (finalMaTK) {
                const [existingTK] = await conn.execute('SELECT maTK FROM taikhoan WHERE maTK = ? AND vaiTro = "GiangVien"', [finalMaTK]);
                if (existingTK.length === 0) {
                    errorRows.push({ row: row.__rowNum__ + 1, error: `Mã TK '${finalMaTK}' không hợp lệ` });
                    continue;
                }
            }
            
            try {
                await conn.execute(
                    `INSERT INTO giangvien (maGV, hoTen, hocVi, email, sdt, maKhoa, maTK) 
                     VALUES (?, ?, ?, ?, ?, ?, ?)`,
                    [maGV, hoTen, hocVi, email || null, sdt || null, maKhoa, finalMaTK]
                );
                successCount++;
            } catch (gvErr) {
                if (shouldAutoCreate && finalMaTK) {
                    await conn.execute('DELETE FROM taikhoan WHERE maTK = ?', [finalMaTK]);
                }
                errorRows.push({ row: row.__rowNum__ + 1, error: `Lỗi insert` });
            }
        }
        
        await conn.release();
        
        let message = `Import thành công ${successCount}/${data.length} dòng.`;
        if (errorRows.length > 0) {
            message += ` Lỗi: ${errorRows.length} dòng`;
        }
        res.json({ message });
        
    } catch (err) {
        console.error('Lỗi import:', err.message);
        res.status(500).json({ message: 'Lỗi máy chủ' });
    }
});

// ===== PUT & DELETE =====
router.put('/:maGV', async (req, res) => {
    const { maGV } = req.params;
    const { hoTen, hocVi, email, sdt, maKhoa, maTK } = req.body;
    
    if (!hoTen) {
        return res.status(400).json({ message: 'Thiếu thông tin bắt buộc' });
    }

    // Xây dựng SQL động - chỉ update những trường được gửi lên
    let updateFields = ['hoTen = ?'];
    let params = [hoTen];

    if (hocVi !== undefined) {
        updateFields.push('hocVi = ?');
        params.push(hocVi);
    }

    if (email !== undefined) {
        updateFields.push('email = ?');
        params.push(email || null);
    }

    if (sdt !== undefined) {
        updateFields.push('sdt = ?');
        params.push(sdt || null);
    }

    if (maKhoa !== undefined) {
        updateFields.push('maKhoa = ?');
        params.push(maKhoa);
    }

    if (maTK !== undefined) {
        updateFields.push('maTK = ?');
        params.push(maTK || null);
    }

    params.push(maGV); // Thêm maGV vào cuối cho WHERE clause

    const sql = `UPDATE giangvien SET ${updateFields.join(', ')} WHERE maGV = ?`;

    try {
        const [result] = await db.execute(sql, params);
        if (result.affectedRows === 0) {
            return res.status(404).json({ message: 'Không tìm thấy giảng viên' });
        }
        res.json({ message: 'Cập nhật thành công' });
    } catch (err) {
        console.error('Lỗi update:', err.message);
        res.status(500).json({ message: 'Lỗi máy chủ: ' + err.message });
    }
});

router.delete('/:maGV', async (req, res) => {
    const { maGV } = req.params;
    
    try {
        const [result] = await db.execute('DELETE FROM giangvien WHERE maGV = ?', [maGV]);
        if (result.affectedRows === 0) {
            return res.status(404).json({ message: 'Không tìm thấy giảng viên' });
        }
        res.json({ message: 'Xóa thành công' });
    } catch (err) {
        if (err.code === 'ER_ROW_IS_REFERENCED_2') { 
            return res.status(400).json({ message: 'Không thể xóa - đang liên kết với lớp hoặc môn học' });
        }
        console.error('Lỗi delete:', err.message);
        res.status(500).json({ message: 'Lỗi máy chủ' });
    }
});

module.exports = router;