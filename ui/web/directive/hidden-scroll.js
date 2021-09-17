import Vue from 'vue';
const tableBodyClass = 'el-table__body-wrapper';

Vue.directive('hidden-scroll', {
  inserted(el, binding, vnode) {
    const refId = binding.value;
    let targetComp = null;
    if (refId) {
      //指定了ref,则只获取该ref
      targetComp = vnode.context.$refs[refId];
    }
    //没有指定ref,默认获取element-table的body元素,因为项目中table滚动条居多
    if (!refId) {
      targetComp = vnode.elm.parentElement.getElementsByClassName(
        tableBodyClass
      )[0];
    }
    //如果也不是table,就取组件本身的dom
    if (!targetComp) targetComp = el;
    //开始监听滚动
    if (targetComp) {
      targetComp = targetComp?.$el ?? targetComp;
      //没滚动时也监测一下滚动条
      scrollHandler(targetComp);
      targetComp.addEventListener('scroll', () => scrollHandler(targetComp));
    }
  }
});

function scrollHandler(targetComp) {
  if (targetComp) {
    let timer = null;
    //显示滚动条
    targetComp.classList.remove('hidden-scroll-bar');
    //滚动条开始的位置
    const start = targetComp.scrollTop;
    //清理定时器
    timer && clearTimeout(timer);
    //隔一秒检查一下是否还在滚动
    timer = setTimeout(() => {
      const end = targetComp.scrollTop;
      if (end === start) {
        //添加隐藏滚动条的样式
        targetComp.classList.add('hidden-scroll-bar');
      }
    }, 1000);
  }
}
export default Vue.directive('hidden-scroll');
