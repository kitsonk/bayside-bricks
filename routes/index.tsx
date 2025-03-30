export default function Home() {
  return (
    <div class="relative text-right w-full">
      <img
        src="https:////www.bricklink.com/myImg/1035859.JPG"
        alt="Bayside Brickstore Logo"
        class="h-96 mt-2 mr-2 ml-auto"
      />
      <main class="absolute text-left top-4 left-4">
        <h1 class="text-5xl font-bold my-4">Welcome to Bayside Brickstore</h1>
        <h2 class="text-3xl my-3">
          Victoria's new kid on the block, selling a wide selection of...
        </h2>
        <ul class="ml-8 space-y-2">
          <li class="flex items-center">
            <img
              class="mr-4"
              src="https://www.bricklink.com/myImg/1035787.JPG"
            />Complete, used sets; many with original packaging;
          </li>
          <li class="flex items-center">
            <img
              class="mr-4"
              src="https://www.bricklink.com/myImg/1035788.JPG"
            />New and used minifigures;
          </li>
          <li class="flex items-center">
            <img
              class="mr-4"
              src="https://www.bricklink.com/myImg/1035789.JPG"
            />Rare bricks and other parts, with new items added daily.
          </li>
        </ul>
        <h2 class="text-3xl my-3">
          Quality, honesty, attention to detail:
        </h2>
        <ul class="ml-8 space-y-2">
          <li class="flex items-center">
            <img
              class="mr-4"
              src="https://www.bricklink.com/myImg/1035790.JPG"
            />
            Every item, every brick, every minifigure that we sell has been
            individually checked, and double-checked to ensure you know what you
            are buying.
          </li>
          <li class="flex items-center">
            <img
              class="mr-4"
              src="https://www.bricklink.com/myImg/1035791.JPG"
            />
            Most used items are sold in near-new condition. Where this is not
            the case, we aim to describe imperfections so you can make an
            informed choice. Unlike other stores, "used" doesn't leave you
            hoping for the best.
          </li>
          <li class="flex items-center">
            <img
              class="mr-4"
              src="https://www.bricklink.com/myImg/1035792.JPG"
            />
            Instant checkouts and fast shipping anywhere across Australia or
            internationally, with discounted or free shipping for larger orders.
          </li>
        </ul>
        <div class="mt-8 italic text-2xl text-center">
          We'll be busy adding inventory over the coming weeks, so come back
          regularly to discover your next build.
        </div>
      </main>
    </div>
  );
}
