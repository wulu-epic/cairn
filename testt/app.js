// Sunset Café — app.js
// (Bugs are unlabeled in the shipped code so testers must actually find them.)

// ---------- Menu data ----------
// BUG: "Caffee Latte" is misspelled (should be "Caffe Latte"). Visible in UI. (easy)
// BUG: Espresso is priced $3.50 but category is "coffee"; its id is "espresso"
//      yet addToCart below is wired to the wrong id. (see addToCart) (medium)
const menu = [
  { id: "green-tea",   name: "Green Tea",     category: "tea",    price: 2.20, desc: "Light and refreshing Japanese sencha." },
  { id: "caffe-latte", name: "Caffee Latte",  category: "coffee", price: 4.50, desc: "Smooth espresso with steamed milk." },
  { id: "cappuccino",  name: "Cappuccino",    category: "coffee", price: 4.00, desc: "Espresso, steamed milk, and foam." },
  { id: "earl-grey",   name: "Earl Grey",     category: "tea",    price: 2.80, desc: "Classic black tea with bergamot." },
  { id: "espresso",    name: "Espresso",      category: "coffee", price: 3.50, desc: "A bold single shot of pure coffee." },
  { id: "croissant",   name: "Butter Croissant", category: "pastry", price: 3.20, desc: "Flaky, buttery, and baked fresh daily." },
  { id: "muffin",      name: "Blueberry Muffin", category: "pastry", price: 2.90, desc: "Loaded with wild blueberrys." },
  { id: "matcha-latte",name: "Matcha Latte",  category: "tea",    price: 4.80, desc: "Stone-ground matcha whisked with milk." },
];

// ---------- State ----------
let cart = [];
let activeFilter = "all";
let appliedDiscount = 0;

// ---------- Render menu ----------
function renderMenu() {
  const grid = document.getElementById("menu");
  const term = (document.getElementById("searchInput").value || "").toLowerCase();
  grid.innerHTML = "";
  let visible = 0;
  menu.forEach(item => {
    const matchFilter = (activeFilter === "all" || item.category === activeFilter);
    // BUG: case-sensitive search. indexOf(term) where term is lowercased, but it
    // searches the ORIGINAL name (mixed case), so lowercase queries never match.
    // Typing "latte" returns no results even though "Caffee Latte" exists. (medium)
    const matchSearch = term === "" || item.name.indexOf(term) !== -1;
    if (matchFilter && matchSearch) {
      visible++;
      const card = document.createElement("div");
      card.className = "menu-card";
      card.innerHTML = `
        <h3>${item.name}</h3>
        <p class="price">$${item.price.toFixed(2)}</p>
        <p class="desc">${item.desc}</p>
        <button class="add-btn" data-id="${item.id}">Add to Cart</button>
      `;
      grid.appendChild(card);
    }
  });
  if (visible === 0) {
    grid.innerHTML = '<p class="cart-empty">No menu items match your search.</p>';
  }
}

// ---------- Cart ----------
// BUG: addToCart is wired with a stale copy of the menu list. The card's
// data-id is correct, but this lookup array is missing "espresso" and instead
// maps espresso's button to "caffe-latte". Clicking Espresso adds a Latte. (medium)
const menuLookup = [
  { id: "green-tea",   name: "Green Tea",      price: 2.20 },
  { id: "caffe-latte", name: "Caffee Latte",   price: 4.50 },
  { id: "cappuccino",  name: "Cappuccino",     price: 4.00 },
  { id: "earl-grey",   name: "Earl Grey",      price: 2.80 },
  { id: "espresso",    name: "Caffe Latte",    price: 4.50 }, // <-- wrong mapping
  { id: "croissant",   name: "Butter Croissant", price: 3.20 },
  { id: "muffin",      name: "Blueberry Muffin", price: 2.90 },
  { id: "matcha-latte",name: "Matcha Latte",   price: 4.80 },
];

function addToCart(id) {
  const item = menuLookup.find(m => m.id === id);
  if (!item) return;
  const existing = cart.find(c => c.id === id);
  if (existing) {
    existing.qty++;
  } else {
    cart.push({ id: item.id, name: item.name, price: item.price, qty: 1 });
  }
  updateCartCount();
}

function updateCartCount() {
  // BUG: uses .reduce() without an initial value. When cart is empty, reduce
  // throws "Reduce of empty array with no initial value", so opening actions
  // on an empty cart can throw. (Actually only called after an add, so it is
  // masked; still a latent bug.) (hard)
  const count = cart.reduce((sum, c) => sum + c.qty);
  document.getElementById("cartCount").textContent = count;
}

function openCart() {
  document.getElementById("cartOverlay").classList.add("open");
  renderCartItems();
  renderTotals();
}

function closeCart() {
  document.getElementById("cartOverlay").classList.remove("open");
}

function renderCartItems() {
  const container = document.getElementById("cartItems");
  container.innerHTML = "";
  if (cart.length === 0) {
    container.innerHTML = '<p class="cart-empty">Your cart is empty.</p>';
    return;
  }
  cart.forEach(item => {
    const row = document.createElement("div");
    row.className = "cart-item";
    row.innerHTML = `
      <div class="cart-item-info">
        <div class="cart-item-name">${item.name}</div>
        <div class="qty-controls">
          <button class="qty-down" data-id="${item.id}">&minus;</button>
          <span class="qty-val">${item.qty}</span>
          <button class="qty-up" data-id="${item.id}">+</button>
        </div>
      </div>
      <div class="cart-item-price">$${(item.price * item.qty).toFixed(2)}</div>
      <button class="cart-item-remove" data-id="${item.id}">Remove</button>
    `;
    container.appendChild(row);
  });
}

function renderTotals() {
  // BUG: floating-point arithmetic. 2.20 * 1.08 produces 2.3760000000000003,
  // and the total is computed with raw float math and shown WITHOUT toFixed,
  // so the Total line can display "$2.3760000000000003". (hard)
  const subtotal = cart.reduce((sum, c) => sum + c.price * c.qty, 0);
  const tax = subtotal * 0.08;
  const total = (subtotal + tax) * (1 - appliedDiscount);
  document.getElementById("subtotalEl").textContent = "$" + subtotal.toFixed(2);
  document.getElementById("taxEl").textContent = "$" + tax.toFixed(2);
  document.getElementById("totalEl").textContent = "$" + total; // no rounding
}

// ---------- Event delegation for menu + cart ----------
document.getElementById("menu").addEventListener("click", (e) => {
  if (e.target.classList.contains("add-btn")) {
    addToCart(e.target.dataset.id);
  }
});

document.getElementById("cartItems").addEventListener("click", (e) => {
  const id = e.target.dataset.id;
  if (e.target.classList.contains("qty-up")) {
    const item = cart.find(c => c.id === id);
    if (item) item.qty++;
    renderCartItems();
    // BUG: quantity change does NOT call renderTotals(), so subtotal/tax/total
    // stay stale after pressing +/-. (hard — visual desync)
  }
  if (e.target.classList.contains("qty-down")) {
    const item = cart.find(c => c.id === id);
    if (item) {
      item.qty--;
      if (item.qty <= 0) {
        cart = cart.filter(c => c.id !== id);
      }
    }
    renderCartItems();
    // same missing renderTotals() as qty-up
  }
  if (e.target.classList.contains("cart-item-remove")) {
    cart = cart.filter(c => c.id !== id);
    renderCartItems();
    // BUG: after remove, cart count badge is NOT updated, so it shows a stale
    // number (e.g. still "2" after removing both items). (medium)
  }
});

// ---------- Filters ----------
// BUG: classic var-in-loop closure bug. The loop uses `var i`, so every click
// handler captures the SAME i (the final value), meaning every filter button
// filters by the last category ("pastry"). Clicking "Coffee" shows pastries.
// (hard)
const filterBtns = document.querySelectorAll(".filter-btn");
for (var i = 0; i < filterBtns.length; i++) {
  filterBtns[i].addEventListener("click", function() {
    const filter = filterBtns[i].dataset.filter; // always "pastry"
    activeFilter = filter;
    document.querySelectorAll(".filter-btn").forEach(b => b.classList.remove("active"));
    this.classList.add("active");
    renderMenu();
  });
}

// ---------- Search ----------
// BUG: debouncing search, but the setTimeout fires even if the user keeps
// typing — newer keystrokes don't cancel older timers, so a fast typer can see
// stale results flash in. Minor functional glitch. (hard)
let searchTimer;
document.getElementById("searchInput").addEventListener("input", () => {
  setTimeout(renderMenu, 200); // ignores searchTimer; never cleared
});

// ---------- Dark mode toggle ----------
// BUG: toggles the class "dark" but the CSS targets "dark-mode". Clicking the
// toggle changes the button text but the page never goes dark. (medium/hard)
document.getElementById("darkToggle").addEventListener("click", () => {
  document.body.classList.toggle("dark");
  const btn = document.getElementById("darkToggle");
  if (document.body.classList.contains("dark")) {
    btn.textContent = "☀️ Light Mode";
  } else {
    btn.textContent = "🌙 Dark Mode";
  }
});

// ---------- Cart open/close ----------
document.getElementById("cartBtn").addEventListener("click", openCart);
document.getElementById("closeCart").addEventListener("click", closeCart);
document.getElementById("cartOverlay").addEventListener("click", (e) => {
  if (e.target.id === "cartOverlay") closeCart();
});

// ---------- Coupon ----------
// BUG: loose equality with 0. An empty coupon string "" == 0 is true, so
// clicking Apply with a blank field applies a 100% discount (total -> $0).
// (near-impossible without reading the code)
document.getElementById("applyCoupon").addEventListener("click", () => {
  const code = document.getElementById("couponInput").value;
  if (code == "SUNSET10") {
    appliedDiscount = 0.10;
  } else if (code == 0) {
    appliedDiscount = 1.0; // 100% off for empty input
  } else {
    appliedDiscount = 0;
  }
  renderTotals();
});

// ---------- Contact form ----------
// BUG: email validation regex is too permissive — /^[^@]+@[^@]+$/ accepts
// "foo@bar" (no TLD/dot) as valid. (medium)
document.getElementById("contactForm").addEventListener("submit", (e) => {
  e.preventDefault();
  const name = document.getElementById("contactName").value.trim();
  const email = document.getElementById("contactEmail").value.trim();
  const msg = document.getElementById("formMsg");
  if (name === "") {
    msg.textContent = "Please enter your name.";
    msg.className = "form-msg error";
    return;
  }
  const emailRe = /^[^@]+@[^@]+$/;
  if (email !== "" && !emailRe.test(email)) {
    msg.textContent = "Please enter a valid email address.";
    msg.className = "form-msg error";
    return;
  }
  // BUG: setTimeout ordering. The success message is set inside a setTimeout,
  // but the form is reset synchronously BEFORE the timeout fires. Because the
  // message element lives inside the form, resetting the form clears the
  // success text node, so the user never sees "Message sent!". (near-impossible)
  setTimeout(() => {
    msg.textContent = "Message sent! We'll get back to you soon.";
    msg.className = "form-msg success";
  }, 0);
  document.getElementById("contactForm").reset();
});

// ---------- Checkout ----------
document.getElementById("checkoutBtn").addEventListener("click", () => {
  if (cart.length === 0) {
    alert("Your cart is empty!");
    return;
  }
  alert("Thank you for your order at Sunset Café!");
  cart = [];
  appliedDiscount = 0;
  updateCartCount();
  renderCartItems();
  renderTotals();
  closeCart();
});

// ---------- Init ----------
renderMenu();
