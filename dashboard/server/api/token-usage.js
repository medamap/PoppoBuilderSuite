const express = require('express');
const path = require('path');
const fs = require('fs').promises;
const router = express.Router();

// トークン使用量を取得
router.get('/usage', async (req, res) => {
    try {
        const { period = 'all' } = req.query;
        
        // CCSPのusage-dataディレクトリを確認
        const usageDataPath = path.join(process.cwd(), 'agents/ccsp/.poppobuilder/ccsp/usage-data');
        
        try {
            await fs.access(usageDataPath);
        } catch (err) {
            // ディレクトリが存在しない場合はゼロデータを返す
            return res.json({
                today: 0,
                week: 0,
                month: 0,
                total: 0,
                history: []
            });
        }
        
        // 使用量データを集計
        const now = new Date();
        const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        const weekStart = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
        const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
        
        let todayUsage = 0;
        let weekUsage = 0;
        let monthUsage = 0;
        let totalUsage = 0;
        const dailyHistory = {};
        
        // ディレクトリ内のJSONファイルを読み込み
        const files = await fs.readdir(usageDataPath);
        const jsonFiles = files.filter(f => f.endsWith('.json'));
        
        for (const file of jsonFiles) {
            const filePath = path.join(usageDataPath, file);
            try {
                const content = await fs.readFile(filePath, 'utf8');
                const data = JSON.parse(content);
                
                if (data.usage && data.usage.totalTokens) {
                    const tokens = data.usage.totalTokens;
                    const timestamp = new Date(data.timestamp || file.replace('.json', ''));
                    
                    totalUsage += tokens;
                    
                    // 期間別集計
                    if (timestamp >= todayStart) {
                        todayUsage += tokens;
                    }
                    if (timestamp >= weekStart) {
                        weekUsage += tokens;
                    }
                    if (timestamp >= monthStart) {
                        monthUsage += tokens;
                    }
                    
                    // 日別履歴
                    const dateKey = timestamp.toISOString().split('T')[0];
                    dailyHistory[dateKey] = (dailyHistory[dateKey] || 0) + tokens;
                }
            } catch (err) {
                console.error(`Error reading usage file ${file}:`, err);
            }
        }
        
        // 日別履歴を配列に変換（最新7日間）
        const historyArray = [];
        for (let i = 6; i >= 0; i--) {
            const date = new Date(now.getTime() - i * 24 * 60 * 60 * 1000);
            const dateKey = date.toISOString().split('T')[0];
            historyArray.push({
                date: dateKey,
                tokens: dailyHistory[dateKey] || 0
            });
        }
        
        res.json({
            today: todayUsage,
            week: weekUsage,
            month: monthUsage,
            total: totalUsage,
            history: historyArray
        });
        
    } catch (error) {
        console.error('Error getting token usage:', error);
        res.status(500).json({ error: 'Failed to get token usage' });
    }
});

// トークン使用量の詳細を取得
router.get('/details', async (req, res) => {
    try {
        const { startDate, endDate } = req.query;
        const start = startDate ? new Date(startDate) : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
        const end = endDate ? new Date(endDate) : new Date();
        
        const usageDataPath = path.join(process.cwd(), 'agents/ccsp/.poppobuilder/ccsp/usage-data');
        const details = [];
        
        try {
            const files = await fs.readdir(usageDataPath);
            const jsonFiles = files.filter(f => f.endsWith('.json'));
            
            for (const file of jsonFiles) {
                const filePath = path.join(usageDataPath, file);
                try {
                    const content = await fs.readFile(filePath, 'utf8');
                    const data = JSON.parse(content);
                    const timestamp = new Date(data.timestamp || file.replace('.json', ''));
                    
                    if (timestamp >= start && timestamp <= end) {
                        details.push({
                            timestamp: timestamp.toISOString(),
                            model: data.model || 'unknown',
                            promptTokens: data.usage?.promptTokens || 0,
                            completionTokens: data.usage?.completionTokens || 0,
                            totalTokens: data.usage?.totalTokens || 0,
                            issueNumber: data.metadata?.issueNumber || null,
                            taskType: data.metadata?.taskType || 'unknown'
                        });
                    }
                } catch (err) {
                    console.error(`Error reading usage file ${file}:`, err);
                }
            }
        } catch (err) {
            // ディレクトリが存在しない場合は空配列を返す
        }
        
        // タイムスタンプでソート（新しい順）
        details.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
        
        res.json({ details });
        
    } catch (error) {
        console.error('Error getting token usage details:', error);
        res.status(500).json({ error: 'Failed to get token usage details' });
    }
});

module.exports = router;