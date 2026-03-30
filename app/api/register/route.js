import { NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import User from '@/models/User';
import Token from '@/models/Token';
import connectDB from '@/lib/db';

const JWT_SECRET = process.env.JWT_SECRET || 'your_jwt_secret';

export async function POST(req) {
  try {
    await connectDB();

    // Handle non-JSON requests safely
    let body;
    try {
      body = await req.json();
    } catch (jsonError) {
      return NextResponse.json({ error: 'Invalid JSON format' }, { status: 400 });
    }

    const { name, email, password, device = 'unknown' } = body || {};

    // Check for missing fields
    if (!name?.trim() || !email?.trim() || !password?.trim()) {
      return NextResponse.json(
        { error: 'Missing required fields: name, email and password are mandatory.' },
        { status: 400 }
      );
    }

    // Email format check
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return NextResponse.json({ error: 'Invalid email format' }, { status: 400 });
    }

    // Password strength check (min 6 characters)
    if (password.length < 6) {
      return NextResponse.json({ error: 'Password must be at least 6 characters' }, { status: 400 });
    }

    // Check if user already exists
    const existingUser = await User.findOne({ email: email.toLowerCase() });
    if (existingUser) {
      return NextResponse.json({ error: 'User with this email already exists' }, { status: 409 });
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(password, 10);

    // Create user
    const user = await User.create({
      name: name.trim(),
      email: email.toLowerCase().trim(),
      password: hashedPassword,
    });

    // Generate JWT token
    const token = jwt.sign({ userId: user._id, email: user.email }, JWT_SECRET, {
      expiresIn: '7d',
    });

    // Save token
    await Token.create({ user: user._id, token, device });

    return NextResponse.json({
      message: 'Registration successful',
      token,
      user: { id: user._id, name: user.name, email: user.email }
    });

  } catch (err) {
    console.error('Registration Error:', err);
    return NextResponse.json({ error: 'Unexpected server error' }, { status: 500 });
  }
}
