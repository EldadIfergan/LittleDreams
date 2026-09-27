// Recording ideas, without deadlines or clinical scoring. Development references:
// https://www.cdc.gov/act-early/milestones/index.html
export const milestoneGroups = [
  {id:'arrival',title:'ההתחלה שלנו',description:'מהמפגש הראשון ועד השגרה החדשה בבית',items:[
    ['birth','הרגע שבו נפגשנו'],['home','היום הראשון בבית'],['bath','המקלחת הראשונה'],
    ['family-meeting','המפגש הראשון עם המשפחה'],['siblings','המפגש הראשון עם האחים'],
    ['walk-outside','הטיול הראשון בעגלה'],['doctor','הביקור הראשון אצל הרופא'],['baby-clinic','הביקור הראשון בטיפת חלב']
  ]},
  {id:'traditions',title:'משפחה, חגים ומסורות',description:'רעיונות לבחירת המשפחה — אין צורך לסמן אירוע שאינו מתאים לכם',items:[
    ['brit','ברית מילה','boy'],['simchat-bat','שמחת בת','girl'],['pidyon','פדיון הבן','boy'],
    ['naming','חגיגת השם'],['first-shabbat','השבת הראשונה יחד'],['first-holiday','החג הראשון יחד'],
    ['first-birthday','יום הולדת שנה'],['second-birthday','יום הולדת שנתיים']
  ]},
  {id:'connection',title:'חיוכים, קולות וקשר',description:'רגעים קטנים של תקשורת והיכרות',items:[
    ['smile','החיוך הראשון'],['laugh','הצחוק הראשון בקול'],['coo','הקולות הראשונים'],
    ['babble','ההברות הראשונות'],['name-response','תגובה לשם'],['wave','נפנוף לשלום'],
    ['clap','מחיאות הכפיים הראשונות'],['point','הצבעה כדי להראות משהו'],
    ['word','המילה הראשונה'],['two-words','צירוף שתי מילים']
  ]},
  {id:'movement',title:'תנועה וגילוי העולם',description:'אפשר לתעד כשזה קורה, בלי סדר חובה או תאריך יעד',items:[
    ['head','הרמת הראש'],['reach','הושטת יד לצעצוע'],['roll','ההתהפכות הראשונה'],
    ['transfer','העברת צעצוע מיד ליד'],['sit','ישיבה עצמאית'],['crawl','הזחילה הראשונה'],
    ['pull-to-stand','התרוממות לעמידה בעזרת רהיט'],['stand','עמידה ראשונה'],
    ['steps','הצעדים הראשונים'],['run','הריצה הראשונה']
  ]},
  {id:'everyday',title:'גדלים ביום־יום',description:'זיכרונות מהארוחות, המשחקים והעצמאות שבדרך',items:[
    ['tooth','השן הראשונה'],['first-food','הטעימה הראשונה'],['cup','שתייה מכוס'],
    ['spoon','אכילה בכפית לבד'],['blocks','מגדל הקוביות הראשון'],['scribble','השרבוט הראשון'],
    ['pretend','משחק דמיון ראשון'],['book','הספר האהוב הראשון']
  ]},
  {id:'experiences',title:'חוויות ראשונות יחד',description:'אירועים נעימים שתבחרו לזכור',items:[
    ['grandparents','ביקור ראשון אצל סבא וסבתא'],['park','הביקור הראשון בפארק'],
    ['sea','הפעם הראשונה בים'],['vacation','החופשה המשפחתית הראשונה'],
    ['haircut','התספורת הראשונה'],['nursery','היום הראשון בגן']
  ]}
];
export const milestones=milestoneGroups.flatMap(group=>group.items.map(([key,title,sex])=>({key,title,sex,group:group.id,groupTitle:group.title,groupDescription:group.description})));
export function milestoneKey(key) {
  if(!milestones.some(item=>item.key===key)) throw Object.assign(new Error('אבן הדרך אינה מוכרת'),{status:400});
  return key;
}
export function checklist(rows,sex='unspecified') {
  const saved=new Map(rows.map(row=>[row.key,row]));
  // Keep previously recorded memories visible even when the child profile changes.
  return milestones.filter(item=>!item.sex||item.sex===sex||saved.get(item.key)?.completed||saved.get(item.key)?.moment_id)
    .map(item=>{const row=saved.get(item.key);return {...item,completed:!!row?.completed,momentId:row?.moment_id||null};});
}
