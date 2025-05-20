function showSection(id) {
  // Hide all sections
  document.querySelectorAll('.content-section')
          .forEach(sec => sec.classList.remove('active-section'));
  // Show selected section
  const target = document.getElementById(id);
  if (target) target.classList.add('active-section');

  // Reset all sidebar links
  document.querySelectorAll('.sidebar a')
          .forEach(link => link.classList.remove('active-link'));

  // Highlight the clicked link
  const clicked = [...document.querySelectorAll('.sidebar a')]
                  .find(link => link.getAttribute('onclick')?.includes(id));
  if (clicked) clicked.classList.add('active-link');

  // Store the tab only during this session
  sessionStorage.setItem('activeSectionId', id);
}

window.addEventListener('DOMContentLoaded', () => {
  const saved = sessionStorage.getItem('activeSectionId');
  if (saved) {
    showSection(saved);
  } else {
    // Default to dashboard if no session preference
    showSection('dashboard');
  }
});


// Tiny JavaScript for toggling Side bar on small screens
document.addEventListener('DOMContentLoaded', () => {
    const sidebar   = document.querySelector('.sidebar');
    const backdrop  = document.getElementById('sidebarBackdrop');
    const toggleBtn = document.getElementById('sidebarToggle');

    const close = () => {
      sidebar.classList.remove('open');
      backdrop.classList.remove('show');
    };

    toggleBtn.addEventListener('click', () => {
      sidebar.classList.toggle('open');
      backdrop.classList.toggle('show');
    });

    backdrop.addEventListener('click', close);

    /* (Optional) close drawer on navigation link click */
    sidebar.querySelectorAll('a').forEach(link =>
      link.addEventListener('click', close)
    );
  });