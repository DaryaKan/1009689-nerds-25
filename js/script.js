(function () {
  const TOTAL_ROUNDS = 10;
  const OPTIONS_COUNT = 6;

  const hexDisplay = document.getElementById("hex-display");
  const optionsContainer = document.getElementById("options");
  const resultEl = document.getElementById("result");
  const scoreEl = document.getElementById("score");
  const roundEl = document.getElementById("round");
  const totalRoundsEl = document.getElementById("total-rounds");
  const btnNext = document.getElementById("btn-next");
  const btnRestart = document.getElementById("btn-restart");

  let score = 0;
  let currentRound = 0;
  let correctColor = "";

  totalRoundsEl.textContent = TOTAL_ROUNDS;

  function randomHex() {
    const hex = Math.floor(Math.random() * 0xffffff).toString(16);
    return "#" + hex.padStart(6, "0");
  }

  function generateColors() {
    const colors = new Set();
    while (colors.size < OPTIONS_COUNT) {
      colors.add(randomHex());
    }
    return [...colors];
  }

  function startRound() {
    const colors = generateColors();
    const correctIndex = Math.floor(Math.random() * OPTIONS_COUNT);
    correctColor = colors[correctIndex];

    currentRound++;
    roundEl.textContent = currentRound;
    hexDisplay.textContent = correctColor.toUpperCase();
    resultEl.textContent = "";
    resultEl.className = "result";
    btnNext.hidden = true;

    optionsContainer.innerHTML = "";

    colors.forEach(function (color) {
      const swatch = document.createElement("div");
      swatch.className = "option";
      swatch.style.backgroundColor = color;
      swatch.dataset.color = color;
      swatch.addEventListener("click", handleGuess);
      optionsContainer.appendChild(swatch);
    });
  }

  function handleGuess(e) {
    const chosen = e.currentTarget.dataset.color;
    const swatches = optionsContainer.querySelectorAll(".option");

    swatches.forEach(function (s) {
      s.classList.add("disabled");
      if (s.dataset.color === correctColor) {
        s.classList.add("correct");
      }
    });

    if (chosen === correctColor) {
      score++;
      scoreEl.textContent = score;
      resultEl.textContent = "Правильно!";
      resultEl.className = "result success";
    } else {
      e.currentTarget.classList.add("wrong");
      resultEl.textContent = "Неверно! Правильный цвет выделен.";
      resultEl.className = "result fail";
    }

    if (currentRound < TOTAL_ROUNDS) {
      btnNext.hidden = false;
    } else {
      showFinalResult();
    }
  }

  function showFinalResult() {
    resultEl.textContent = "Игра окончена! Результат: " + score + " из " + TOTAL_ROUNDS;
    resultEl.className = "result success";
    btnRestart.hidden = false;
  }

  btnNext.addEventListener("click", function () {
    startRound();
  });

  btnRestart.addEventListener("click", function () {
    score = 0;
    currentRound = 0;
    scoreEl.textContent = score;
    btnRestart.hidden = true;
    startRound();
  });

  startRound();
})();
