// What a visitor sees while the Urgent help page is built on the server.
//
// Without this file the nearest boundary is app/(public)/[firm]/loading.tsx, which is drawn as
// the home page: a hero and a grid of services, for somebody who has just tapped "Urgent help".
// The one thing this page is for needs no data at all, so it is here before anything else
// arrives: a static line and a tel: link, which work even if the page never finishes loading.
//
// data-header-cta="quiet" for the same reason the page itself carries it (see page.tsx): the
// header's booking button is not the action here.

import { buttonClasses } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";

export default function UrgentHelpLoading() {
  return (
    <div data-header-cta="quiet" className="mx-auto max-w-[1180px] px-4 py-8 sm:px-6 sm:py-12 lg:px-8">
      <div className="max-w-[720px]">
        <p className="text-17 font-semibold text-ink">If anyone is in danger, call 112.</p>
        <a href="tel:112" className={buttonClasses("primary", "lg", "mt-4 w-full sm:w-auto")}>
          <Icon name="phone" size={18} />
          Call 112
        </a>
        <p role="status" className="sr-only">
          Loading the rest of this page
        </p>
      </div>
    </div>
  );
}
