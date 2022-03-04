import React, { useEffect, useState } from 'react';

const FakeComponent = () => {
  window.close();
  // we never reach this line, but it will make react happy
  return <></>;
};

export const CountExit = (props) => {
  const [timeLeft, setTimeLeft] = useState<number>(props.secondsToClose ?? 5);
  useEffect(() => {
    setInterval(
      () =>
        setTimeLeft((preTimeLeft) => {
          return preTimeLeft - 1;
        }),
      1000,
    );
  }, []);
  return timeLeft < 0 ? (
    <FakeComponent />
  ) : (
    <div>
      <h3>{props.message}</h3>
      <p>
        window will closed in <b>{timeLeft}</b> seconds.
      </p>
    </div>
  );
};
