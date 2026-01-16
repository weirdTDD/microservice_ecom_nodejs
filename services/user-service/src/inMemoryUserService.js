{/* Fallback in-memory user storage when MongoDB is not available
const users = new Map();
let userIdCounter = 1;

const inMemoryUserService = {
  createUser: async (userData) => {
    const userId = `USER-${Date.now()}-${userIdCounter++}`;
    const user = {
      ...userData,
      userId,
      createdAt: new Date(),
      updatedAt: new Date(),
      isActive: true,
      role: userData.role || 'customer'
    };
    
    // Simulate password hashing
    user.password = `hashed_${userData.password}`;
    
    users.set(userId, user);
    
    return {
      userId: user.userId,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      role: user.role
    };
  },
  
  findUserByEmail: async (email) => {
    for (const user of users.values()) {
      if (user.email === email) {
        return user;
      }
    }
    return null;
  },
  
  findUserById: async (userId) => {
    return users.get(userId);
  },
  
  getAllUsers: async () => {
    return Array.from(users.values()).map(user => ({
      userId: user.userId,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      role: user.role
    }));
  }
};

module.exports = inMemoryUserService;
*/}