// Sample restaurant content (menu, stock, recipes, customers) — plain data, edit freely.


export type MenuRow = [name: string, price: number, veg: number, code: string, variants?: [string, number][]];

export const MENU: Record<string, MenuRow[]> = {
  Starters: [
    ['Paneer Tikka', 260, 1, 'PT', [['Half', 160], ['Full', 260]]],
    ['Veg Spring Roll', 180, 1, 'VSR'],
    ['Hara Bhara Kabab', 220, 1, 'HBK'],
    ['Chicken 65', 280, 0, 'C65'],
    ['Chicken Tikka', 300, 0, 'CT', [['Half', 180], ['Full', 300]]],
    ['Fish Amritsari', 340, 0, 'FA'],
  ],
  'Main Course': [
    ['Paneer Butter Masala', 280, 1, 'PBM'],
    ['Dal Makhani', 220, 1, 'DM'],
    ['Kadai Paneer', 270, 1, 'KP'],
    ['Veg Kolhapuri', 240, 1, 'VK'],
    ['Butter Chicken', 340, 0, 'BC', [['Half', 200], ['Full', 340]]],
    ['Chicken Curry', 300, 0, 'CC'],
    ['Mutton Rogan Josh', 420, 0, 'MRJ'],
  ],
  Breads: [
    ['Tandoori Roti', 30, 1, 'TR'],
    ['Butter Roti', 40, 1, 'BR'],
    ['Butter Naan', 60, 1, 'BN'],
    ['Garlic Naan', 80, 1, 'GN'],
    ['Lachha Paratha', 70, 1, 'LP'],
  ],
  'Rice & Biryani': [
    ['Steamed Rice', 140, 1, 'SR'],
    ['Jeera Rice', 170, 1, 'JR'],
    ['Veg Biryani', 240, 1, 'VB'],
    ['Chicken Biryani', 320, 0, 'CB', [['Regular', 320], ['Family Pack', 720]]],
    ['Mutton Biryani', 400, 0, 'MB'],
  ],
  Chinese: [
    ['Veg Hakka Noodles', 190, 1, 'VHN'],
    ['Veg Manchurian', 210, 1, 'VM', [['Dry', 210], ['Gravy', 220]]],
    ['Chicken Fried Rice', 230, 0, 'CFR'],
    ['Chilli Chicken', 290, 0, 'CHC', [['Dry', 290], ['Gravy', 300]]],
  ],
  Beverages: [
    ['Masala Chai', 40, 1, 'MC'],
    ['Cold Coffee', 120, 1, 'CF'],
    ['Fresh Lime Soda', 90, 1, 'FLS', [['Sweet', 90], ['Salted', 90], ['Mixed', 90]]],
    ['Mango Lassi', 110, 1, 'ML'],
    ['Soft Drink', 60, 1, 'SD'],
    ['Mineral Water', 30, 1, 'MW'],
  ],
  Desserts: [
    ['Gulab Jamun', 90, 1, 'GJ'],
    ['Rasmalai', 120, 1, 'RM'],
    ['Brownie with Ice Cream', 180, 1, 'BIC'],
    ['Kulfi', 100, 1, 'KF'],
  ],
};

export const INVENTORY: [string, string, number, number, number][] = [
  ['Paneer', 'kg', 8, 2, 380], ['Chicken', 'kg', 15, 5, 240], ['Mutton', 'kg', 6, 2, 650],
  ['Basmati Rice', 'kg', 25, 10, 110], ['Wheat Flour (Atta)', 'kg', 20, 5, 45], ['Maida', 'kg', 15, 5, 50],
  ['Butter', 'kg', 5, 1, 520], ['Cooking Oil', 'ltr', 20, 5, 150], ['Onion', 'kg', 30, 10, 35],
  ['Tomato', 'kg', 6, 8, 40], ['Milk', 'ltr', 15, 5, 60], ['Fresh Cream', 'ltr', 4, 1, 220],
  ['Spice Mix', 'kg', 5, 1, 400], ['Coffee Powder', 'kg', 1, 0.25, 900], ['Tea Leaves', 'kg', 2, 0.5, 450],
  ['Sugar', 'kg', 10, 3, 45], ['Lemons', 'pcs', 100, 30, 3], ['Soft Drink Bottles', 'pcs', 20, 24, 25],
  ['Water Bottles', 'pcs', 60, 24, 10], ['Fish Fillet', 'kg', 4, 2, 520],
];

export const RECIPES: Record<string, [string, number][]> = {
  'Paneer Tikka': [['Paneer', 0.2], ['Spice Mix', 0.01], ['Cooking Oil', 0.02]],
  'Paneer Butter Masala': [['Paneer', 0.18], ['Butter', 0.03], ['Fresh Cream', 0.03], ['Tomato', 0.15], ['Onion', 0.1]],
  'Kadai Paneer': [['Paneer', 0.18], ['Onion', 0.1], ['Tomato', 0.1], ['Cooking Oil', 0.03]],
  'Dal Makhani': [['Butter', 0.02], ['Fresh Cream', 0.02]],
  'Butter Chicken': [['Chicken', 0.25], ['Butter', 0.04], ['Fresh Cream', 0.04], ['Tomato', 0.15]],
  'Chicken Tikka': [['Chicken', 0.25], ['Spice Mix', 0.01]],
  'Chicken 65': [['Chicken', 0.25], ['Cooking Oil', 0.05]],
  'Chicken Curry': [['Chicken', 0.25], ['Onion', 0.15], ['Tomato', 0.1]],
  'Chilli Chicken': [['Chicken', 0.22], ['Cooking Oil', 0.04]],
  'Fish Amritsari': [['Fish Fillet', 0.2], ['Cooking Oil', 0.05]],
  'Mutton Rogan Josh': [['Mutton', 0.25], ['Onion', 0.1]],
  'Mutton Biryani': [['Mutton', 0.2], ['Basmati Rice', 0.2]],
  'Chicken Biryani': [['Chicken', 0.2], ['Basmati Rice', 0.2]],
  'Veg Biryani': [['Basmati Rice', 0.2]],
  'Steamed Rice': [['Basmati Rice', 0.15]],
  'Jeera Rice': [['Basmati Rice', 0.15]],
  'Chicken Fried Rice': [['Basmati Rice', 0.15], ['Chicken', 0.1]],
  'Tandoori Roti': [['Wheat Flour (Atta)', 0.08]],
  'Butter Roti': [['Wheat Flour (Atta)', 0.08], ['Butter', 0.005]],
  'Butter Naan': [['Maida', 0.1], ['Butter', 0.01]],
  'Garlic Naan': [['Maida', 0.1], ['Butter', 0.01]],
  'Lachha Paratha': [['Wheat Flour (Atta)', 0.1], ['Butter', 0.015]],
  'Masala Chai': [['Milk', 0.1], ['Tea Leaves', 0.005], ['Sugar', 0.01]],
  'Cold Coffee': [['Milk', 0.2], ['Coffee Powder', 0.01], ['Sugar', 0.02]],
  'Fresh Lime Soda': [['Lemons', 1], ['Sugar', 0.02]],
  'Mango Lassi': [['Milk', 0.2], ['Sugar', 0.02]],
  'Soft Drink': [['Soft Drink Bottles', 1]],
  'Mineral Water': [['Water Bottles', 1]],
};

export const CUSTOMERS: [string, string, string | null][] = [
  ['Aarav Sharma', '9810011111', '1990-03-14'], ['Priya Nair', '9820022222', '1988-07-22'],
  ['Rohan Gupta', '9830033333', null], ['Ananya Iyer', '9840044444', '1995-11-02'],
  ['Vikram Singh', '9850055555', null], ['Sneha Reddy', '9860066666', '1992-01-30'],
  ['Karan Mehta', '9870077777', null], ['Divya Menon', '9880088888', '1998-05-18'],
  ['Arjun Patel', '9890099999', null], ['Meera Joshi', '9800012345', '1985-09-09'],
  ['Farhan Khan', '9811122334', null], ['Lakshmi Rao', '9822233445', '1979-12-25'],
];
