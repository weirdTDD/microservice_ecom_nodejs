import express from 'express';
import userRoutes from './routes/userRoutes.js';
import { connectDb } from './db/sqlite.js';

connectDb()
  ? console.log('✅ SQLite connected')
  : console.log('⚠️ Using memory DB');

const app = express();
app.use(express.json());
app.use('/api/users', userRoutes);

app.listen( process.env.PORT, () =>
  console.log(`🚀 user-service running `)
);
