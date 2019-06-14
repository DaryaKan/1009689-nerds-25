var link = document.querySelector(".contacts-button"),
    popup = document.querySelector(".write-us-hidden"),
    close = popup.querySelector(".modal-close"),
    form = popup.querySelector("form"),
    name = popup.querySelector("[name=name]"),
    email = popup.querySelector("[name=email]"),
    storage = localStorage.getItem("name");
link.addEventListener(
    "click",
     function(e) {
        e.preventDefault(),
        popup.classList.add("write-us-active"),
        storage ? (name.value = storage, email.focus()) : name.focus()
    }), 
close.addEventListener(
    "click",
    function(e) {
        e.preventDefault(),
        popup.classList.remove("write-us-active"), popup.classList.remove("error")
    }),
form.addEventListener(
    "submit",
    function(e) {
        name.value && email.value ? localStorage.setItem("name", name.value) : (e.preventDefault(), popup.classList.remove("error"), popup.offsetWidth = popup.offsetWidth, popup.classList.add("error"))
    }), 
window.addEventListener("keydown", function(e) {
    27 === e.keyCode && popup.classList.contains("write-us-active") && (popup.classList.remove("write-us-active"), popup.classList.remove("error"))
});